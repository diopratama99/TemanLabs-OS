# Moving from TrueNAS SCALE

How to move a TrueNAS SCALE server to Ubuntu Server with TemanLabsOS, keeping your ZFS pool, its files, its snapshots and your apps' data.

**English** &nbsp;|&nbsp; [Bahasa Indonesia](migrate-truenas.id.md)

---

## Contents

- [What stays safe](#what-stays-safe)
- [1. Before you start, on TrueNAS](#1-before-you-start-on-truenas)
- [2. Install Ubuntu and TemanLabsOS](#2-install-ubuntu-and-temanlabsos)
- [3. Import the pool](#3-import-the-pool)
- [4. Where your files are](#4-where-your-files-are)
- [5. Shares and users](#5-shares-and-users)
- [6. Apps](#6-apps)
- [7. Keeping the data safe](#7-keeping-the-data-safe)
- [Going back to TrueNAS](#going-back-to-truenas)
- [Troubleshooting](#troubleshooting)

---

## What stays safe

The pool lives on its own drives, and moving to Ubuntu doesn't change them. TemanLabsOS is careful with them:

- **Importing never formats or erases a drive.** Disk Manager won't format a drive that belongs to a ZFS pool, whether the pool is imported or not.
- **Check Read-Only first.** You can import the pool read-only, look through every folder, and only then use it normally. Nothing is written to the drives while it's read-only, and after a restart the pool is untouched.
- **A snapshot right away.** A normal import takes a snapshot of the whole pool (`temanlabs-imported-…`) before anything else, so you can always go back to how the pool came from TrueNAS.
- **The pool isn't changed.** TemanLabsOS doesn't upgrade the pool or change its properties, so it can go back to TrueNAS. (The one exception: a dataset whose mount point would cover a system folder such as `/usr` is set to `canmount=noauto` so it isn't mounted over the system at startup. Its files aren't touched.)
- **Snapshots are kept.** Your TrueNAS snapshots stay. The only snapshots TemanLabsOS ever removes are its own daily ones (`temanlabs-auto-…`), past the number you choose to keep.

The one step that can lose data is installing Ubuntu on the wrong drive. Step 2 covers that.

## 1. Before you start, on TrueNAS

1. **Check the pool is healthy.** In **Storage**, the pool should be *Online* with no errors. Run a scrub and wait for it to finish. Don't move a degraded pool; replace the failing drive first.
2. **Download the configuration.** **System → General → Manage Configuration → Download File**, with *Export Password Secret Seed* ticked. With it you can go back to TrueNAS exactly as it was.
3. **Export the encryption keys** if any dataset is encrypted with a key (not a passphrase): **Datasets → (the pool) → Export Keys**. Keep the file somewhere other than the pool.
4. **Write down what you'll set up again:**
   - SMB shares: each share's name and path (for example `/mnt/tank/media`), and who can use it.
   - Users that sign in to the shares.
   - Apps: which ones you run, and the host paths they use.
5. **Have a backup of what you can't lose.** ZFS is reliable, but a copy of irreplaceable files on another drive or in the cloud is what makes any move stress-free.

You don't need to export (disconnect) the pool; shutting TrueNAS down is enough. If you do use **Export/Disconnect**, leave **Destroy data on this pool** unticked.

## 2. Install Ubuntu and TemanLabsOS

1. Note which drive TrueNAS is installed on (**System → Boot**). That's the drive Ubuntu replaces; the pool's drives aren't touched.
2. **Safest:** unplug the pool's drives while you install Ubuntu, and plug them back in afterwards. Then the installer can't even see them.
3. Install Ubuntu Server 24.04 or 26.04 on the TrueNAS boot drive (or a new one). In the installer's storage step, pick only that drive.
4. Install TemanLabsOS as in [Installing TemanLabsOS](installation.md).

## 3. Import the pool

1. Open **Disk Manager**. The pool's drives are listed, and a **ZFS Pools** section appears in the sidebar.
2. Choose **Import Pools**. The first time, choose **Install ZFS Tools** (the `zfsutils-linux` package). It doesn't touch any drive.
3. Your pool is listed with its drives. Choose **Check Read-Only**.
4. Open the pool in the sidebar, choose its folder under **Mounted at** and look through your files in Files.
5. When everything is there, choose **Use Normally**. The pool is imported again for normal use, a snapshot is taken, and from now on it's imported every time the server starts.

TrueNAS's own system pool (`boot-pool`) is never imported: it's TrueNAS's system, not data.

**Encrypted datasets** show as locked. Enter the passphrase, or the hex key from the keys file you exported, under **Encrypted datasets are locked**. The key isn't saved on the server; unlock them again after a restart.

## 4. Where your files are

TrueNAS mounts a pool under `/mnt` (`/mnt/tank`). Ubuntu mounts it at the pool's own mount point, usually `/tank`. TemanLabsOS links `/mnt/tank` to it, so both paths work, as do paths in your scripts and in apps' settings. TrueNAS apps' data (`/mnt/.ix-apps`) is linked the same way.

The pool also appears in **Files** under Locations, and in the **Storage** widget.

## 5. Shares and users

Set up the shares you noted in **File Sharing**: add a share for each folder, for example `/mnt/tank/media`, and add the users who sign in to them. The files and their permissions are already on the pool.

## 6. Apps

Open the pool in Disk Manager. Under **Apps from TrueNAS**:

- **TrueNAS 24.10 (Electric Eel) and later** run apps with Docker. Each one is listed; **Install** runs it with the same setup TrueNAS used and the data it had. Nothing is copied: the app uses its folders on the pool. If an app lists folders the server doesn't have, they were outside the pool; create them or change the app's folders after installing.
- **Earlier TrueNAS SCALE** (Kubernetes apps) can't be run as they were. Install the app again from the **App Center**, then point its folders at the old data, under `ix-applications/releases/<app>/volumes` on the pool (**Data** opens it).

## 7. Keeping the data safe

- **Daily snapshots:** turn on **Daily snapshots** on the pool's page and choose how many to keep. To get a file back, open a snapshot under **Snapshots** and copy the file out.
- **Scrub** about once a month (**Scrub Now**). It reads every file and repairs any that went bad from the pool's other copy.
- **Health:** a pool that isn't healthy shows a warning in Disk Manager and in the Storage widget, with what's wrong and which drive.
- **Backups:** snapshots live on the same drives. For a copy elsewhere, set up **Settings → Backup** to another drive or a cloud drive.

## Going back to TrueNAS

Install TrueNAS again and import the pool there (**Storage → Import Pool**), then restore the configuration file you downloaded. The pool wasn't upgraded, so TrueNAS reads it as before. Snapshots TemanLabsOS made stay on the pool; delete them in TrueNAS if you don't need them.

Don't run `zpool upgrade` on Ubuntu if you might go back: a pool upgraded to newer features can't be imported by an older TrueNAS.

## Troubleshooting

**"This pool uses ZFS features newer than this server's ZFS."** The pool was made by a newer TrueNAS than Ubuntu's ZFS. **Check Read-Only** often still works. To use it normally, install Ubuntu 26.04, whose ZFS is newer.

**"The pool was last accessed by another system."** Expected: that system was TrueNAS. Importing handles it.

**A drive is missing.** The pool shows as *Degraded* (still usable) with the missing drive marked. Check its cable and power, then refresh. If too many drives are missing, the pool can't be imported until they're back.

**A dataset wasn't mounted.** Its mount point would cover a system folder or a folder that already has files. The pool's page lists it. Its files are safe; give it another mount point (`sudo zfs set mountpoint=/tank/name <dataset>`) to use it.
