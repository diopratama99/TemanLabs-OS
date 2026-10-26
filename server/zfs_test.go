package main

import "testing"

func TestParseZpoolStatus(t *testing.T) {
	out := "  pool: tank\n" +
		" state: DEGRADED\n" +
		"status: One or more devices could not be used because the label is missing or\n" +
		"\tinvalid.  Sufficient replicas exist for the pool to continue\n" +
		"\tfunctioning in a degraded state.\n" +
		"action: Replace the device using 'zpool replace'.\n" +
		"  scan: scrub repaired 0B in 00:10:02 with 0 errors on Sun Oct 12 00:34:03 2026\n" +
		"config:\n" +
		"\n" +
		"\tNAME                      STATE     READ WRITE CKSUM\n" +
		"\ttank                      DEGRADED     0     0     0\n" +
		"\t  mirror-0                DEGRADED     0     0     0\n" +
		"\t    /dev/sdb1             ONLINE       0     0     0\n" +
		"\t    1234567890123         UNAVAIL      0     0     0  was /dev/sdc1\n" +
		"\tlogs\n" +
		"\t  /dev/nvme0n1p4          ONLINE       0     0  1.2K\n" +
		"\n" +
		"errors: No known data errors\n" +
		"\n" +
		"  pool: rpool\n" +
		" state: ONLINE\n" +
		"config:\n" +
		"\n" +
		"\tNAME        STATE     READ WRITE CKSUM\n" +
		"\trpool       ONLINE       0     0     0\n" +
		"\t  sda3      ONLINE       0     0     0\n" +
		"\n" +
		"errors: No known data errors\n"
	r := parseZpoolReports(out)
	if len(r) != 2 {
		t.Fatalf("got %d reports", len(r))
	}
	tank := r[0]
	if tank.fields["pool"] != "tank" || tank.fields["state"] != "DEGRADED" || tank.fields["errors"] != "No known data errors" {
		t.Errorf("fields = %v", tank.fields)
	}
	if want := "One or more devices could not be used because the label is missing or invalid.  Sufficient replicas exist for the pool to continue functioning in a degraded state."; tank.fields["status"] != want {
		t.Errorf("status = %q", tank.fields["status"])
	}
	if len(tank.vdevs) != 2 || tank.vdevs[0].Name != "tank" || tank.vdevs[1].Name != "logs" {
		t.Fatalf("top vdevs = %+v", tank.vdevs)
	}
	mirror := tank.vdevs[0].Children[0]
	if mirror.Name != "mirror-0" || len(mirror.Children) != 2 {
		t.Fatalf("mirror = %+v", mirror)
	}
	if gone := mirror.Children[1]; gone.State != "UNAVAIL" || gone.Note != "was /dev/sdc1" || gone.Read != "0" {
		t.Errorf("missing drive = %+v", gone)
	}
	if log := tank.vdevs[1].Children[0]; log.Cksum != "1.2K" {
		t.Errorf("log = %+v", log)
	}
	if r[1].fields["pool"] != "rpool" || len(r[1].vdevs[0].Children) != 1 {
		t.Errorf("rpool = %+v", r[1])
	}
}

func TestParseZpoolImport(t *testing.T) {
	out := "   pool: tank\n" +
		"     id: 15378461712423906371\n" +
		"  state: ONLINE\n" +
		" status: The pool was last accessed by another system.\n" +
		" action: The pool can be imported using its name or numeric identifier and\n" +
		"\tthe '-f' flag.\n" +
		"   see: https://openzfs.github.io/openzfs-docs/msg/ZFS-8000-EY\n" +
		" config:\n" +
		"\n" +
		"\ttank        ONLINE\n" +
		"\t  raidz1-0  ONLINE\n" +
		"\t    sdb     ONLINE\n" +
		"\t    sdc     ONLINE\n" +
		"\t    sdd     ONLINE\n" +
		"\n" +
		"   pool: boot-pool\n" +
		"     id: 99\n" +
		"  state: ONLINE\n" +
		" action: The pool can be imported using its name or numeric identifier.\n" +
		" config:\n" +
		"\n" +
		"\tboot-pool   ONLINE\n" +
		"\t  sde3      ONLINE\n"
	r := parseZpoolReports(out)
	if len(r) != 2 || r[0].fields["id"] != "15378461712423906371" || r[1].fields["pool"] != "boot-pool" {
		t.Fatalf("reports = %+v", r)
	}
	if r[0].fields["action"] != "The pool can be imported using its name or numeric identifier and the '-f' flag." {
		t.Errorf("action = %q", r[0].fields["action"])
	}
	raidz := r[0].vdevs[0].Children[0]
	if raidz.Name != "raidz1-0" || len(raidz.Children) != 3 || raidz.Children[2].State != "ONLINE" {
		t.Errorf("raidz = %+v", raidz)
	}
}

func TestUnsafeMount(t *testing.T) {
	for _, p := range []string{"/", "/usr", "/var/lib", "/home", "/mnt"} {
		if unsafeMount(p) == "" {
			t.Errorf("%s should be unsafe", p)
		}
	}
	for _, p := range []string{"none", "legacy", "/tank-that-does-not-exist", "/.ix-apps-missing"} {
		if why := unsafeMount(p); why != "" {
			t.Errorf("%s: %s", p, why)
		}
	}
}
