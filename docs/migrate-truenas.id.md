# Pindah dari TrueNAS SCALE

Cara memindahkan server TrueNAS SCALE ke Ubuntu Server dengan TemanLabsOS, tanpa kehilangan pool ZFS, file-filenya, snapshot-nya, maupun data app-mu.

[English](migrate-truenas.md) &nbsp;|&nbsp; **Bahasa Indonesia**

---

## Daftar isi

- [Yang tetap aman](#yang-tetap-aman)
- [1. Sebelum mulai, di TrueNAS](#1-sebelum-mulai-di-truenas)
- [2. Pasang Ubuntu dan TemanLabsOS](#2-pasang-ubuntu-dan-temanlabsos)
- [3. Import pool](#3-import-pool)
- [4. Letak file-filemu](#4-letak-file-filemu)
- [5. Share dan user](#5-share-dan-user)
- [6. App](#6-app)
- [7. Menjaga data tetap aman](#7-menjaga-data-tetap-aman)
- [Kembali ke TrueNAS](#kembali-ke-truenas)
- [Mengatasi masalah](#mengatasi-masalah)

---

## Yang tetap aman

Pool ada di drive-nya sendiri, dan pindah ke Ubuntu tidak mengubahnya. TemanLabsOS juga berhati-hati dengan drive itu:

- **Import tidak pernah memformat atau menghapus drive.** Disk Manager menolak memformat drive yang menjadi bagian pool ZFS, baik pool-nya sudah di-import maupun belum.
- **Cek baca-saja dulu.** Pool bisa di-import dalam mode baca-saja, jadi kamu bisa memeriksa semua folder sebelum memakainya secara normal. Selama baca-saja, tidak ada yang ditulis ke drive, dan setelah restart pool kembali seperti semula.
- **Langsung ada snapshot.** Import normal mengambil snapshot seluruh pool (`temanlabs-imported-…`) sebelum langkah lain. Dengan itu kamu selalu bisa kembali ke kondisi pool saat dibawa dari TrueNAS.
- **Pool tidak diubah.** TemanLabsOS tidak meng-upgrade pool dan tidak mengubah properti-nya, jadi pool masih bisa dipakai lagi di TrueNAS. Satu-satunya pengecualian: dataset yang mount point-nya akan menutupi folder sistem seperti `/usr` diatur ke `canmount=noauto`, supaya tidak ter-mount di atas sistem saat startup. File-filenya tidak disentuh.
- **Snapshot tetap disimpan.** Snapshot dari TrueNAS tidak dihapus. Satu-satunya snapshot yang pernah dihapus TemanLabsOS adalah snapshot hariannya sendiri (`temanlabs-auto-…`) yang melebihi jumlah yang kamu pilih untuk disimpan.

Satu-satunya langkah yang bisa menghilangkan data adalah memasang Ubuntu di drive yang salah. Cara menghindarinya ada di langkah 2.

## 1. Sebelum mulai, di TrueNAS

1. **Pastikan pool sehat.** Di **Storage**, pool harus *Online* tanpa error. Jalankan scrub dan tunggu sampai selesai. Jangan memindahkan pool yang sedang degraded; ganti dulu drive yang bermasalah.
2. **Unduh konfigurasi.** Buka **System → General → Manage Configuration → Download File**, dengan *Export Password Secret Seed* dicentang. Dengan file ini kamu bisa kembali ke TrueNAS persis seperti sebelumnya.
3. **Ekspor kunci enkripsi** kalau ada dataset yang dienkripsi dengan kunci (bukan passphrase): **Datasets → (pool-nya) → Export Keys**. Simpan file-nya di tempat lain, bukan di pool itu.
4. **Catat apa saja yang perlu diatur ulang:**
   - Share SMB: nama dan path tiap share (misalnya `/mnt/tank/media`), dan siapa yang boleh memakainya.
   - User yang login ke share.
   - App: app apa saja yang kamu jalankan, dan folder host yang dipakainya.
5. **Siapkan backup untuk yang tidak boleh hilang.** ZFS memang andal, tapi salinan file penting di drive lain atau di cloud yang membuat perpindahan apa pun terasa tenang.

Pool tidak perlu di-export (disconnect); cukup matikan TrueNAS. Kalau tetap memakai **Export/Disconnect**, jangan centang **Destroy data on this pool**.

## 2. Pasang Ubuntu dan TemanLabsOS

1. Catat drive tempat TrueNAS terpasang (**System → Boot**). Drive itulah yang diganti Ubuntu; drive pool tidak disentuh.
2. **Paling aman:** cabut drive pool selama memasang Ubuntu, lalu pasang kembali setelah selesai. Dengan begitu installer bahkan tidak bisa melihatnya.
3. Pasang Ubuntu Server 24.04 atau 26.04 di drive boot TrueNAS (atau drive baru). Di langkah storage installer, pilih drive itu saja.
4. Pasang TemanLabsOS seperti di [Instalasi TemanLabsOS](installation.id.md).

## 3. Import pool

1. Buka **Disk Manager**. Drive pool-mu tampil di daftar, dan bagian **Pool ZFS** muncul di sidebar.
2. Pilih **Import Pool**. Pertama kali, pilih **Pasang Alat ZFS** (paket `zfsutils-linux`). Langkah ini tidak menyentuh drive apa pun.
3. Pool-mu tampil beserta drive-nya. Pilih **Cek Baca-Saja**.
4. Buka pool itu di sidebar, klik foldernya di **Di-mount di**, lalu periksa file-filemu di Files.
5. Kalau semuanya lengkap, pilih **Gunakan Normal**. Pool di-import ulang untuk dipakai normal, snapshot diambil, dan mulai sekarang pool di-import otomatis setiap server menyala.

Pool sistem milik TrueNAS (`boot-pool`) tidak pernah di-import, karena isinya sistem TrueNAS, bukan data.

**Dataset terenkripsi** tampil terkunci. Masukkan passphrase, atau kunci hex dari file kunci yang sudah kamu ekspor, di bagian **dataset terenkripsi masih terkunci**. Kunci tidak disimpan di server; setelah restart, buka lagi.

## 4. Letak file-filemu

TrueNAS me-mount pool di bawah `/mnt` (`/mnt/tank`). Ubuntu me-mount-nya di mount point milik pool itu sendiri, biasanya `/tank`. TemanLabsOS membuat link dari `/mnt/tank` ke sana, jadi kedua path bisa dipakai, begitu juga path di script dan pengaturan app-mu. Data app TrueNAS (`/mnt/.ix-apps`) di-link dengan cara yang sama.

Pool juga muncul di **Files** di bagian Lokasi, dan di widget **Penyimpanan**.

## 5. Share dan user

Atur kembali share yang sudah kamu catat di **Berbagi File**: tambahkan share untuk tiap folder, misalnya `/mnt/tank/media`, lalu tambahkan user yang login ke share itu. File-file dan izinnya sudah ada di pool.

## 6. App

Buka pool di Disk Manager. Di bagian **App dari TrueNAS**:

- **TrueNAS 24.10 (Electric Eel) ke atas** menjalankan app dengan Docker. Setiap app tampil di daftar, dan **Pasang** menjalankannya dengan pengaturan yang sama seperti di TrueNAS, beserta datanya. Tidak ada yang disalin: app memakai foldernya yang ada di pool. Kalau sebuah app menampilkan folder yang tidak ada di server ini, berarti folder itu ada di luar pool; buat foldernya, atau ubah folder app-nya setelah dipasang.
- **TrueNAS SCALE versi lama** (app Kubernetes) tidak bisa dijalankan seperti sebelumnya. Pasang lagi app-nya dari **App Center**, lalu arahkan foldernya ke data lama di `ix-applications/releases/<app>/volumes` pada pool (tombol **Data** membukanya).

## 7. Menjaga data tetap aman

- **Snapshot harian:** nyalakan **Snapshot harian** di halaman pool dan pilih berapa yang disimpan. Untuk mengembalikan file, buka snapshot di bagian **Snapshot** lalu salin file-nya keluar.
- **Scrub** sekitar sebulan sekali (**Scrub Sekarang**). Scrub membaca setiap file dan memperbaiki yang rusak dari salinan lain di pool.
- **Kesehatan:** pool yang tidak sehat memunculkan peringatan di Disk Manager dan di widget Penyimpanan, lengkap dengan masalahnya dan drive mana yang terkena.
- **Backup:** snapshot tersimpan di drive yang sama. Untuk salinan di tempat lain, atur **Pengaturan → Backup** ke drive lain atau cloud drive.

## Kembali ke TrueNAS

Pasang lagi TrueNAS dan import pool di sana (**Storage → Import Pool**), lalu pulihkan file konfigurasi yang sudah kamu unduh. Pool tidak di-upgrade, jadi TrueNAS membacanya seperti sebelumnya. Snapshot buatan TemanLabsOS tetap ada di pool; hapus lewat TrueNAS kalau tidak diperlukan.

Kalau ada kemungkinan kembali ke TrueNAS, jangan jalankan `zpool upgrade` di Ubuntu: pool yang di-upgrade ke fitur lebih baru tidak bisa di-import TrueNAS versi lama.

## Mengatasi masalah

**"This pool uses ZFS features newer than this server's ZFS."** Pool dibuat oleh TrueNAS yang ZFS-nya lebih baru daripada ZFS di Ubuntu. **Cek Baca-Saja** biasanya tetap bisa. Untuk memakainya secara normal, pasang Ubuntu 26.04 yang ZFS-nya lebih baru.

**"The pool was last accessed by another system."** Ini wajar: sistem itu adalah TrueNAS. Proses import sudah menanganinya.

**Ada drive yang hilang.** Pool tampil *Degraded* (masih bisa dipakai), dan drive yang hilang ditandai. Periksa kabel data dan dayanya, lalu muat ulang. Kalau terlalu banyak drive yang hilang, pool baru bisa di-import setelah drive-nya kembali.

**Ada dataset yang tidak di-mount.** Mount point-nya akan menutupi folder sistem atau folder yang sudah berisi file. Halaman pool mencantumkannya. File-filenya aman; beri mount point lain (`sudo zfs set mountpoint=/tank/nama <dataset>`) untuk memakainya.
