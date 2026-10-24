# Kubernetes lab: container orchestration for small network services

This guide uses TemanLabsOS to **deploy and manage a few network services (web, database, monitoring) in containers**, with Docker and Kubernetes (k3s) on one Ubuntu server.

**English** &nbsp;|&nbsp; [Bahasa Indonesia](kubernetes-lab.id.md)

Every step can be done in TemanLabsOS's **Kubernetes app** (by clicking) or with **`kubectl`** in the Terminal. The app shows the matching `kubectl` command in its bottom panel (the `>_` icon), so the results go straight into a report.

---

## 1. The ideas in brief

| Term | Meaning | In this lab |
|---|---|---|
| **Container** | An isolated process that carries an app and everything it needs. | Every service |
| **Docker** | Builds and runs containers. | App Center, System Monitor |
| **Kubernetes** | Orchestrates containers: scheduling, networking, scaling, self-healing. | k3s |
| **Node** | A machine that runs pods. | The server itself (1 node) |
| **Pod** | The smallest unit: one or more containers sharing an IP. | `web-…`, `db-0`, … |
| **Deployment** | Keeps a number of identical pods (replicas) running, and updates them step by step. | `web`, `adminer`, `prometheus`, `grafana` |
| **StatefulSet** | Like a Deployment, but pods keep their names and each has its own volume. | `db` (PostgreSQL) |
| **DaemonSet** | Exactly one pod on every node. | `node-exporter` |
| **Service** | A fixed name and IP in front of a set of pods, and a load balancer. `NodePort` opens it on a port of the server. | `web`, `db`, … |
| **ConfigMap / Secret** | Configuration and passwords outside the image. | `web-content`, `db-secret`, … |
| **PersistentVolumeClaim** | Storage that stays when a pod is removed. | `data-db-0` (1 Gi) |
| **Namespace** | A "folder" for resources. | `lab` |

The basic idea is **desired state**: you write down how things should be (YAML), and Kubernetes' controllers keep working until reality matches it.

---

## 2. The lab's layout

```
                       Ubuntu server (1 k3s node)
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
   Docker keeps running alongside (App Center apps, TemanLabsOS on port 80 and others)
```

| Service | Image | In the browser | Login |
|---|---|---|---|
| Web | `nginx:1.27-alpine` | `http://<server-ip>:30080` | — |
| Adminer (database UI) | `adminer:4` | `http://<server-ip>:30081` | server `db`, user `lab`, password `lab-password`, database `labdb` |
| Prometheus | `prom/prometheus:v2.54.1` | `http://<server-ip>:30090` | — |
| Grafana | `grafana/grafana:11.2.0` | `http://<server-ip>:30300` | `admin` / `admin` |

The full manifest is [`k8s/lab.yaml`](k8s/lab.yaml).

---

## 3. Setting up the cluster

### In TemanLabsOS
1. Open the **Kubernetes** app.
2. Click **Install Kubernetes (k3s)** and wait 1–2 minutes, until the log shows the node *Ready*.

### In a terminal (the same thing by hand)
```bash
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server --disable traefik --write-kubeconfig-mode 600" sh -s -
sudo k3s kubectl get nodes -o wide
```

Why k3s?
- An official, CNCF-certified Kubernetes distribution that's light, made for a single server, and uses about 500 MB of RAM.
- Traefik is turned off so port 80 stays with TemanLabsOS. Services are opened through NodePorts (30000–32767).
- k3s has its own containerd, so the Docker containers already running aren't disturbed.

---

## 4. Deploying the services

### In TemanLabsOS
**Kubernetes → Deploy → Lab Stack → Deploy**. There are also separate templates for just the web, database or monitoring part.

### In a terminal
```bash
sudo k3s kubectl apply -f docs/k8s/lab.yaml
sudo k3s kubectl get pods -n lab -w          # wait until all are Running (Ctrl+C to stop)
```

The first time, the images have to download (2–5 minutes). Follow it in **Pods** and **Events**.

Check the result:
```bash
sudo k3s kubectl get all,pvc -n lab
```

---

## 5. Exercises

Do them in order. Each one shows one thing orchestration does.

### Exercise 1: Load balancing
Open `http://<server-ip>:30080` and reload a few times. The pod name on the page changes, because the Service spreads requests over the three replicas.
```bash
for i in $(seq 10); do curl -s http://localhost:30080 | grep -o 'web-[a-z0-9]*-[a-z0-9]*'; done | sort | uniq -c
```

### Exercise 2: Scaling
**Workloads → web → the + button** up to 5 replicas. Two new pods appear in **Pods**.
```bash
sudo k3s kubectl scale deployment web -n lab --replicas=5
sudo k3s kubectl get pods -n lab -l app=web
```
Set it back to 3 when you're done.

### Exercise 3: Self-healing
**Pods → the trash icon** on one of the `web-…` pods. The ReplicaSet makes a new pod straight away.
```bash
sudo k3s kubectl delete pod -n lab -l app=web --wait=false
sudo k3s kubectl get pods -n lab -l app=web -w
```

### Exercise 4: Rolling update and rollback
Right-click **web → Update Image…** and enter `nginx:1.26-alpine`. Pods are replaced one at a time, and the website stays up the whole time. Then right-click **web → Roll Back to Previous Version**.
```bash
sudo k3s kubectl set image deployment/web nginx=nginx:1.26-alpine -n lab
sudo k3s kubectl rollout status deployment/web -n lab
sudo k3s kubectl rollout history deployment/web -n lab
sudo k3s kubectl rollout undo deployment/web -n lab
```

### Exercise 5: Data that stays
1. Open Adminer (`:30081`) and sign in (server `db`, user `lab`, password `lab-password`, database `labdb`).
2. Create a table and add a row. For example:
   ```sql
   CREATE TABLE notes (id serial PRIMARY KEY, body text);
   INSERT INTO notes (body) VALUES ('this must still be here');
   ```
3. Delete the database pod: **Pods → db-0 → delete**, or:
   ```bash
   sudo k3s kubectl delete pod db-0 -n lab
   ```
4. Once `db-0` is Running again, open the table. The row is still there, because it's stored in the PersistentVolumeClaim `data-db-0`, not inside the container.
   ```bash
   sudo k3s kubectl exec -n lab db-0 -- psql -U lab -d labdb -c 'SELECT * FROM notes;'
   ```

### Exercise 6: Monitoring
1. Open Grafana (`:30300`, `admin`/`admin`), then **Dashboards → Lab → Server (node-exporter)**. Its graphs show the server's CPU, memory, network and disk.
2. In Prometheus (`:30090`) → **Status → Targets**, check that `node` and `prometheus` are **UP**.
3. Try a query: `100 - avg(rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100`.
4. Scale `web` up a lot (e.g. 10) and watch the CPU and memory graphs change.

### Exercise 7: Compare with Docker
Open **System Monitor → Containers** to see plain Docker containers. Docker only runs the containers you ask for:
- there are no replicas or load balancer built in;
- a restart policy only restarts a crashed container on the same host;
- a container you stop or remove isn't replaced.

Compare that with exercises 2 and 3, where Kubernetes itself keeps the number of pods where you want it.

---

## 6. Docker and Kubernetes compared

| | Docker alone | Kubernetes |
|---|---|---|
| Runs containers | Yes | Yes (through containerd) |
| Many replicas and load balancing | By hand | Automatic (Deployment + Service) |
| A container/pod dies | Start it yourself, or `--restart` | Made again automatically (self-healing) |
| A new version | Stop, then start, with downtime | Rolling update and rollback |
| Configuration | Commands or compose | Declarative (YAML, *desired state*) |
| Scale | One host | Many nodes |

---

## 7. Common `kubectl` commands

```bash
sudo k3s kubectl get nodes -o wide                  # node status
sudo k3s kubectl get all -n lab                     # everything in the lab namespace
sudo k3s kubectl describe deployment web -n lab     # details and events
sudo k3s kubectl logs -n lab deploy/web             # logs
sudo k3s kubectl top pod -n lab                     # CPU (millicores, "m") and memory (Mi)
sudo k3s kubectl get events -n lab --sort-by=.lastTimestamp
```

Units in Kubernetes:
- CPU is counted in **millicores**: `1000m` = 1 core, so `250m` is a quarter of a core.
- Memory uses binary units: `Mi` = mebibyte, `Gi` = gibibyte.

---

## 8. Cleaning up

```bash
sudo k3s kubectl delete namespace lab               # remove the whole lab (the database's data too)
/usr/local/bin/k3s-uninstall.sh                     # remove k3s completely (run with sudo)
```

k3s can also be removed in the app: **Kubernetes → Overview → Remove Kubernetes…**.

---

## 9. Limits and next steps

- **One node**: if the server goes down, so does every service. The next step is adding worker nodes (`k3s agent`) for high availability.
- The sample passwords (`admin/admin`, `lab-password`) are for learning only. For real use, use strong Secrets and HTTPS (Ingress + TLS).
- There's no autoscaling yet. A HorizontalPodAutoscaler can add it, since k3s already has metrics-server.

---

## 10. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| A pod stays in `ContainerCreating` / `ImagePullBackOff` | The image is still downloading, or DNS fails. Check **Events**, and make sure the server can reach `registry-1.docker.io`. |
| Warning `FailedCreatePodSandBox … flannel` right after installing | Normal: pod networking isn't ready yet. It goes away within seconds. |
| `Readiness probe failed` while a new pod starts | Normal while the app in the pod is still booting. |
| A NodePort doesn't open from a laptop | Make sure the server's firewall allows ports 30000–32767, and use the right server IP (LAN or Tailscale). |
| The database's data is gone | Make sure only the **pod** was deleted, not the `lab` namespace (deleting the namespace also deletes its PVC). |
