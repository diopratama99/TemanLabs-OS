package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestListDisksGroupsZFSPools(t *testing.T) {
	// A pool kept from TrueNAS: every dataset is its own mount.
	mounts := `rpool/ROOT/ubuntu / zfs rw 0 0
bpool/BOOT/ubuntu /boot zfs rw 0 0
tank /mnt/tank zfs rw 0 0
tank/media /mnt/tank/media zfs rw 0 0
tank/.system /mnt/tank/.system zfs rw 0 0
tank/ix-applications /mnt/tank/ix-applications zfs rw 0 0
/dev/sdb1 /mnt/usb ext4 rw 0 0
tmpfs /run tmpfs rw 0 0
`
	const G = 1 << 30
	space := map[string]fsSpace{
		"/":                         {total: 50 * G, used: 10 * G, free: 40 * G},
		"/mnt/tank":                 {total: 101 * G, used: 1 * G, free: 100 * G},
		"/mnt/tank/media":           {total: 400 * G, used: 300 * G, free: 100 * G},
		"/mnt/tank/.system":         {total: 102 * G, used: 2 * G, free: 100 * G},
		"/mnt/tank/ix-applications": {total: 105 * G, used: 5 * G, free: 100 * G},
		"/mnt/usb":                  {total: 64 * G, used: 4 * G, free: 60 * G},
	}
	stat := func(m string) (fsSpace, bool) { s, ok := space[m]; return s, ok }
	noZFS := func(string) (uint64, uint64, bool) { return 0, 0, false }

	got := listDisks(strings.NewReader(mounts), stat, noZFS)
	want := []disk{
		{Name: "System", Mount: "/", Used: 10 * G, Total: 50 * G, Pool: "rpool"},
		{Name: "tank", Mount: "/mnt/tank", Used: 308 * G, Total: 408 * G, Pool: "tank"},
		{Name: "usb", Mount: "/mnt/usb", Used: 4 * G, Total: 64 * G},
	}
	if len(got) != len(want) {
		t.Fatalf("got %d disks %+v, want %+v", len(got), got, want)
	}
	for i := range want {
		// The device it came from isn't part of what is sent.
		g := got[i]
		g.source = ""
		if g != want[i] {
			t.Errorf("disk %d = %+v, want %+v", i, got[i], want[i])
		}
	}

	// zfs's own numbers (snapshots included) win when it answers.
	withZFS := func(pool string) (uint64, uint64, bool) { return 350 * G, 100 * G, pool == "tank" }
	if d := listDisks(strings.NewReader(mounts), stat, withZFS)[1]; d.Used != 350*G || d.Total != 450*G {
		t.Errorf("tank with zfs list = %+v", d)
	}
}

func TestExternalDrive(t *testing.T) {
	root := t.TempDir()
	class := filepath.Join(root, "class", "block")
	mk := func(dir string, files map[string]string) {
		if err := os.MkdirAll(filepath.Join(root, dir), 0o755); err != nil {
			t.Fatal(err)
		}
		for name, v := range files {
			_ = os.WriteFile(filepath.Join(root, dir, name), []byte(v), 0o644)
		}
	}
	// A USB disk with a partition, an internal SATA disk, and an SD card on an internal reader.
	usb := "devices/pci0000:00/0000:00:14.0/usb2/2-1/2-1:1.0/host6/target6:0:0/6:0:0:0/block/sdc"
	sata := "devices/pci0000:00/0000:00:17.0/ata1/host0/target0:0:0/0:0:0:0/block/sda"
	card := "devices/platform/mmc0/mmc_host/mmc0/mmc0:0001/block/mmcblk0"
	mk(usb, map[string]string{"removable": "0\n"})
	mk(usb+"/sdc1", map[string]string{"partition": "1\n"})
	mk(sata, map[string]string{"removable": "0\n"})
	mk(sata+"/sda2", map[string]string{"partition": "2\n"})
	mk(card, map[string]string{"removable": "1\n"})
	mk(card+"/mmcblk0p1", map[string]string{"partition": "1\n"})
	mk("class/block", nil)
	for name, target := range map[string]string{"sdc": usb, "sdc1": usb + "/sdc1", "sda": sata, "sda2": sata + "/sda2", "mmcblk0": card, "mmcblk0p1": card + "/mmcblk0p1"} {
		if err := os.Symlink(filepath.Join("..", "..", target), filepath.Join(class, name)); err != nil {
			t.Fatal(err)
		}
	}
	for dev, want := range map[string]string{"/dev/sdc1": "/dev/sdc", "/dev/sdc": "/dev/sdc", "/dev/sda2": "", "/dev/mmcblk0p1": "/dev/mmcblk0", "/dev/nvme0n1p1": ""} {
		got, ok := externalDrive(class, dev)
		if got != want || ok != (want != "") {
			t.Errorf("externalDrive(%s) = %q, %v; want %q", dev, got, ok, want)
		}
	}
}
