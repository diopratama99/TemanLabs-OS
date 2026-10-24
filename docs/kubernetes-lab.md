# Lab Kubernetes: Container Orchestration untuk Layanan Jaringan Skala Kecil

Panduan ini memakai TemanLabsOS untuk **mendeploy dan mengelola beberapa layanan jaringan (web, database, monitoring) di lingkungan container**, dengan Docker dan Kubernetes (k3s) di satu server Ubuntu.

Setiap langkah bisa dikerjakan lewat **app Kubernetes** di TemanLabsOS (klik) atau lewat **`kubectl`** di Terminal. App-nya menampilkan perintah `kubectl` yang setara di panel bawah (ikon `>_`), jadi hasilnya bisa langsung dipakai untuk laporan.

---

## 1. Konsep singkat

| Istilah | Arti | Di lab ini |
|---|---|---|
| **Container** | Proses terisolasi yang membawa app beserta dependensinya. | Semua layanan |
| **Docker** | Membuat dan menjalankan container. | App Center, System Monitor |
| **Kubernetes** | Mengorkestrasi container: penjadwalan, jaringan, scaling, self-healing. | k3s |
| **Node** | Mesin yang menjalankan pod. | Server itu sendiri (1 node) |
| **Pod** | Unit terkecil: satu atau lebih container dengan IP bersama. | `web-…`, `db-0`, … |
| **Deployment** | Menjaga sejumlah pod identik (replika) tetap jalan, dan meng-update-nya bertahap. | `web`, `adminer`, `prometheus`, `grafana` |
| **StatefulSet** | Seperti Deployment, tapi nama pod tetap dan tiap pod punya volume sendiri. | `db` (PostgreSQL) |
| **DaemonSet** | Tepat satu pod di setiap node. | `node-exporter` |
| **Service** | Nama dan IP tetap di depan sekumpulan pod, sekaligus load balancer. `NodePort` membukanya di port server. | `web`, `db`, … |
| **ConfigMap / Secret** | Konfigurasi dan password di luar image. | `web-content`, `db-secret`, … |
| **PersistentVolumeClaim** | Penyimpanan yang tetap ada walaupun pod dihapus. | `data-db-0` (1 Gi) |
| **Namespace** | "Folder" untuk resource. | `lab` |

Prinsip dasarnya **desired state**: kamu menulis keadaan yang diinginkan (YAML), lalu controller Kubernetes terus bekerja sampai keadaan nyata sama dengan itu.

---

## 2. Arsitektur lab

```
                       Server Ubuntu (1 node k3s)
 ┌───────────────────────────── namespace: lab ─────────────────────────────┐
 │                                                                          │
 │  WEB          Deployment web (nginx ×3) ──▶ Service web     NodePort 30080│
 │                                                                          │
 │  DATABASE     StatefulSet db (PostgreSQL 16) + PVC 1Gi + Secret          │
 │                 └─ Service db (ClusterIP :5432)                          │
 │               Deployment adminer ─────────▶ Service adminer NodePort 30081│
 │                                                                          │
 │  MONITORING   DaemonSet node-exporter ──▶ Prometheus ──▶ Grafana          │
 │                                             NodePort 30090   NodePort 30300│
 └──────────────────────────────────────────────────────────────────────────┘
   Docker tetap berjalan berdampingan (app CasaOS / App Center, port 80 dan lainnya)
```

| Layanan | Image | Akses dari browser | Login |
|---|---|---|---|
| Web | `nginx:1.27-alpine` | `http://<ip-server>:30080` | — |
| Adminer (UI database) | `adminer:4` | `http://<ip-server>:30081` | server `db`, user `lab`, password `lab-password`, database `labdb` |
| Prometheus | `prom/prometheus:v2.54.1` | `http://<ip-server>:30090` | — |
| Grafana | `grafana/grafana:11.2.0` | `http://<ip-server>:30300` | `admin` / `admin` |

Manifest lengkapnya ada di [`k8s/lab.yaml`](k8s/lab.yaml).

---

## 3. Menyiapkan cluster

### Lewat TemanLabsOS
1. Buka app **Kubernetes** di Dock.
2. Klik **Install Kubernetes (k3s)**, lalu tunggu 1–2 menit sampai log menunjukkan node *Ready*.

### Lewat terminal (cara manual yang setara)
```bash
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server --disable traefik --write-kubeconfig-mode 600" sh -s -
sudo k3s kubectl get nodes -o wide
```

Kenapa k3s?
- Distribusi Kubernetes resmi (bersertifikat CNCF) yang ringan, cocok untuk satu server, dan memakai sekitar 500 MB RAM.
- Traefik dimatikan supaya port 80 tetap dipakai CasaOS. Layanan dibuka lewat NodePort (30000–32767).
- k3s memakai containerd sendiri, sehingga container Docker yang sudah ada tidak terganggu.

---

## 4. Mendeploy layanan

### Lewat TemanLabsOS
**Kubernetes → Deploy → Lab Stack → Deploy**. Ada juga template terpisah untuk web, database, atau monitoring saja.

### Lewat terminal
```bash
sudo k3s kubectl apply -f docs/k8s/lab.yaml
sudo k3s kubectl get pods -n lab -w          # tunggu semua Running (Ctrl+C untuk berhenti)
```

Pertama kali, image harus diunduh dulu (2–5 menit). Pantau prosesnya di **Pods** dan **Events**.

Cek hasilnya:
```bash
sudo k3s kubectl get all,pvc -n lab
```

---

## 5. Latihan

Kerjakan berurutan. Setiap latihan menunjukkan satu kemampuan orkestrasi.

### Latihan 1: Load balancing
Buka `http://<ip-server>:30080` dan refresh beberapa kali. Nama pod di halaman berganti, karena Service membagi request ke ketiga replika.
```bash
for i in $(seq 10); do curl -s http://localhost:30080 | grep -o 'web-[a-z0-9]*-[a-z0-9]*'; done | sort | uniq -c
```

### Latihan 2: Scaling
**Workloads → web → tombol +** sampai 5 replika. Di **Pods** akan muncul 2 pod baru.
```bash
sudo k3s kubectl scale deployment web -n lab --replicas=5
sudo k3s kubectl get pods -n lab -l app=web
```
Kembalikan ke 3 setelah selesai.

### Latihan 3: Self-healing
**Pods → ikon tempat sampah** di salah satu pod `web-…`. ReplicaSet langsung membuat pod pengganti.
```bash
sudo k3s kubectl delete pod -n lab -l app=web --wait=false
sudo k3s kubectl get pods -n lab -l app=web -w
```

### Latihan 4: Rolling update dan rollback
Klik kanan **web → Update Image…**, isi `nginx:1.26-alpine`. Pod diganti satu per satu, dan web tetap bisa diakses selama proses berlangsung. Setelah itu klik kanan **web → Roll Back to Previous Version**.
```bash
sudo k3s kubectl set image deployment/web nginx=nginx:1.26-alpine -n lab
sudo k3s kubectl rollout status deployment/web -n lab
sudo k3s kubectl rollout history deployment/web -n lab
sudo k3s kubectl rollout undo deployment/web -n lab
```

### Latihan 5: Persistensi data
1. Buka Adminer (`:30081`) dan login (server `db`, user `lab`, password `lab-password`, database `labdb`).
2. Buat tabel dan isi datanya. Contoh SQL:
   ```sql
   CREATE TABLE catatan (id serial PRIMARY KEY, isi text);
   INSERT INTO catatan (isi) VALUES ('data ini harus tetap ada');
   ```
3. Hapus pod database: **Pods → db-0 → hapus**, atau:
   ```bash
   sudo k3s kubectl delete pod db-0 -n lab
   ```
4. Setelah `db-0` Running lagi, buka tabelnya. Datanya masih ada karena tersimpan di PersistentVolumeClaim `data-db-0`, bukan di dalam container.
   ```bash
   sudo k3s kubectl exec -n lab db-0 -- psql -U lab -d labdb -c 'SELECT * FROM catatan;'
   ```

### Latihan 6: Monitoring
1. Buka Grafana (`:30300`, `admin`/`admin`), lalu **Dashboards → Lab → Server (node-exporter)**. Grafiknya menampilkan CPU, memori, jaringan, dan disk server.
2. Di Prometheus (`:30090`) → **Status → Targets**, pastikan `node` dan `prometheus` berstatus **UP**.
3. Coba query: `100 - avg(rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100`.
4. Scale `web` ke angka besar (mis. 10), lalu lihat perubahannya di grafik CPU dan memori.

### Latihan 7: Bandingkan dengan Docker
Buka **System Monitor → Containers** untuk melihat container Docker biasa. Docker hanya menjalankan container yang kamu minta:
- tidak ada replika atau load balancer bawaan;
- restart policy hanya menyalakan ulang container yang crash di host yang sama;
- container yang kamu hentikan atau hapus tidak diganti dengan yang baru.

Bandingkan dengan Latihan 2 dan 3, di mana Kubernetes sendiri yang menjaga jumlah pod tetap sesuai keinginan.

---

## 6. Docker vs Kubernetes

| Aspek | Docker saja | Kubernetes |
|---|---|---|
| Menjalankan container | ✔ | ✔ (lewat containerd) |
| Banyak replika + load balancing | Manual | Otomatis (Deployment + Service) |
| Container/pod mati | Harus dinyalakan sendiri, atau `--restart` | Dibuat ulang otomatis (self-healing) |
| Update versi | Stop lalu start, ada downtime | Rolling update dan rollback |
| Konfigurasi | Perintah atau compose | Deklaratif (YAML, *desired state*) |
| Skala | Satu host | Banyak node |

---

## 7. Perintah `kubectl` yang sering dipakai

```bash
sudo k3s kubectl get nodes -o wide                  # status node
sudo k3s kubectl get all -n lab                     # semua resource di namespace lab
sudo k3s kubectl describe deployment web -n lab     # detail dan event
sudo k3s kubectl logs -n lab deploy/web             # log
sudo k3s kubectl top pod -n lab                     # pemakaian CPU (millicore, "m") dan memori (Mi)
sudo k3s kubectl get events -n lab --sort-by=.lastTimestamp
```

Satuan di Kubernetes:
- CPU dihitung dalam **millicore**: `1000m` = 1 core, jadi `250m` = seperempat core.
- Memori memakai satuan biner: `Mi` = mebibyte, `Gi` = gibibyte.

---

## 8. Membersihkan

```bash
sudo k3s kubectl delete namespace lab               # hapus seluruh lab (termasuk data database)
/usr/local/bin/k3s-uninstall.sh                     # hapus k3s sepenuhnya (jalankan dengan sudo)
```

k3s juga bisa dihapus lewat app: **Kubernetes → Overview → Remove Kubernetes…**.

---

## 9. Keterbatasan dan pengembangan

- **Single node**: kalau server mati, semua layanan ikut mati. Pengembangan berikutnya adalah menambah node worker (`k3s agent`) untuk high availability.
- Password contoh (`admin/admin`, `lab-password`) hanya untuk belajar. Untuk produksi, pakai Secret yang kuat dan HTTPS (Ingress + TLS).
- Belum ada autoscaling. Bisa ditambahkan dengan HorizontalPodAutoscaler, karena metrics-server sudah tersedia di k3s.

---

## 10. Troubleshooting

| Gejala | Penyebab dan solusi |
|---|---|
| Pod lama di `ContainerCreating` / `ImagePullBackOff` | Image masih diunduh atau DNS gagal. Cek **Events**, dan pastikan server bisa mengakses `registry-1.docker.io`. |
| Warning `FailedCreatePodSandBox … flannel` tepat setelah install | Normal, jaringan pod belum siap. Hilang sendiri dalam beberapa detik. |
| `Readiness probe failed` saat pod baru dibuat | Normal selama app di dalam pod masih booting. |
| NodePort tidak bisa dibuka dari laptop | Pastikan firewall server mengizinkan port 30000–32767, dan pakai IP server yang benar (LAN atau Tailscale). |
| Data database hilang | Pastikan yang dihapus hanya **pod**-nya, bukan namespace `lab` (menghapus namespace juga menghapus PVC-nya). |
