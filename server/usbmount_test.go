package main

import (
	"testing"
	"time"
)

func TestStaleMounts(t *testing.T) {
	mounts := `/dev/sda1 /mnt/HDD_DATA ext4 rw 0 0
/dev/sdb1 /media/HDD exfat rw 0 0
/dev/sdc1 /media/HDD exfat rw 0 0
/dev/sdd1 /media/HDD exfat rw 0 0
/dev/sde1 /media/My\040Stick vfat rw 0 0
/dev/sdf1 /media/Card vfat rw 0 0
/dev/sdg1 /media/Card vfat rw 0 0
`
	// sdb–sdd and sdf are gone; the stick (sde) and the card's newer mount (sdg) are there.
	exists := func(dev string) bool { return dev == "/dev/sda1" || dev == "/dev/sde1" || dev == "/dev/sdg1" }
	got := staleMounts(mounts, exists)
	if len(got) != 2 {
		t.Fatalf("staleMounts = %v, want /media/HDD and /media/Card", got)
	}
	if st := got["/media/HDD"]; st.total != 3 || st.stale != 3 || len(st.live) != 0 {
		t.Errorf("HDD %+v", *st)
	}
	if st := got["/media/Card"]; st.total != 2 || st.stale != 1 || len(st.live) != 1 || st.live[0] != "/dev/sdg1" {
		t.Errorf("Card %+v", *st)
	}
}

func TestUSBMounterPausesAFlappingDrive(t *testing.T) {
	u := &usbMounter{seen: map[string]bool{}, gone: map[string]time.Time{}, flaps: map[string][]time.Time{}, paused: map[string]time.Time{}}
	now := time.Date(2026, 11, 1, 10, 0, 0, 0, time.UTC)
	if !u.back("hdd", now) {
		t.Fatal("first time plugged in")
	}
	// It drops out and comes back seconds later, again and again.
	for i := 1; i <= 2; i++ {
		u.gone["hdd"] = now.Add(time.Duration(i) * 30 * time.Second)
		if !u.back("hdd", now.Add(time.Duration(i)*30*time.Second+5*time.Second)) {
			t.Fatalf("drop-out %d: paused too early", i)
		}
	}
	u.gone["hdd"] = now.Add(90 * time.Second)
	if u.back("hdd", now.Add(95*time.Second)) {
		t.Fatal("third drop-out within 10 minutes: should be left alone")
	}
	if u.back("hdd", now.Add(5*time.Minute)) {
		t.Error("still paused after 5 minutes")
	}
	if !u.back("hdd", now.Add(12*time.Minute)) {
		t.Error("not mounted again once the pause is over")
	}
	// Unplugged for a while and plugged in again is no drop-out.
	u.gone["stick"] = now
	if !u.back("stick", now.Add(time.Hour)) {
		t.Error("a drive plugged in again later")
	}
}

func TestLiveDisks(t *testing.T) {
	disks := []disk{
		{Name: "System", Mount: "/", source: "/dev/mapper/root"},
		{Name: "HDD", Mount: "/media/HDD", source: "/dev/sdb1"},
		{Name: "HDD", Mount: "/media/HDD", source: "/dev/sdc1"},
		{Name: "HDD", Mount: "/media/HDD", source: "/dev/sdd1"},
		{Name: "GoogleDrive", Mount: "/DATA/Cloud/GoogleDrive", source: "GoogleDrive:", Cloud: true},
	}
	exists := func(dev string) bool { return dev == "/dev/mapper/root" || dev == "/dev/sdd1" }
	got := liveDisks(disks, exists)
	if len(got) != 3 || got[1].source != "/dev/sdd1" || got[2].Name != "GoogleDrive" {
		t.Errorf("liveDisks = %+v", got)
	}
}
