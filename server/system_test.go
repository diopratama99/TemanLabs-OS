package main

import (
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
		if got[i] != want[i] {
			t.Errorf("disk %d = %+v, want %+v", i, got[i], want[i])
		}
	}

	// zfs's own numbers (snapshots included) win when it answers.
	withZFS := func(pool string) (uint64, uint64, bool) { return 350 * G, 100 * G, pool == "tank" }
	if d := listDisks(strings.NewReader(mounts), stat, withZFS)[1]; d.Used != 350*G || d.Total != 450*G {
		t.Errorf("tank with zfs list = %+v", d)
	}
}
