package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Kubernetes: a single-node k3s cluster next to Docker, managed (and explained) from the web.
// Every call answers with the kubectl command it ran, so the window can teach the CLI too.

const (
	k3sBinary    = "/usr/local/bin/k3s"
	k3sUninstall = "/usr/local/bin/k3s-uninstall.sh"
	k3sConfig    = "/etc/rancher/k3s/k3s.yaml"
)

var (
	k8sName  = regexp.MustCompile(`^[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$`)
	k8sKinds = map[string]string{
		"deployment": "deployment", "statefulset": "statefulset", "daemonset": "daemonset", "pod": "pod",
		"service": "service", "pvc": "persistentvolumeclaim", "configmap": "configmap", "secret": "secret",
		"ingress": "ingress", "namespace": "namespace", "job": "job", "cronjob": "cronjob",
	}
)

func k3sInstalled() bool {
	_, err := os.Stat(k3sBinary)
	return err == nil
}

// kubectl runs k3s's bundled kubectl; the command line comes back for the window to show.
func kubectl(ctx context.Context, stdin string, args ...string) ([]byte, string, error) {
	shown := "kubectl " + strings.Join(quoteArgs(args), " ")
	cmd := exec.CommandContext(ctx, k3sBinary, append([]string{"kubectl"}, args...)...)
	cmd.Env = append(os.Environ(), "KUBECONFIG="+k3sConfig)
	if stdin != "" {
		cmd.Stdin = strings.NewReader(stdin)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		// One request for several kinds repeats the same error once per kind: say it once.
		var lines []string
		for _, line := range strings.Split(strings.TrimSpace(stderr.String()), "\n") {
			if line = strings.TrimSpace(line); line != "" && !slices.Contains(lines, line) {
				lines = append(lines, line)
			}
		}
		msg := strings.Join(lines, "\n")
		if msg == "" {
			msg = err.Error()
		}
		return out, shown, errors.New(msg)
	}
	return out, shown, nil
}

func quoteArgs(args []string) []string {
	out := make([]string, len(args))
	for i, a := range args {
		if strings.ContainsAny(a, " \"'$") {
			out[i] = strconv.Quote(a)
		} else {
			out[i] = a
		}
	}
	return out
}

// ----- Status and installation -----

type k8sNode struct {
	Name      string `json:"name"`
	Ready     bool   `json:"ready"`
	Roles     string `json:"roles"`
	Version   string `json:"version"`
	IP        string `json:"ip"`
	OS        string `json:"os"`
	Runtime   string `json:"runtime"`
	CPU       string `json:"cpu"`
	Memory    string `json:"memory"`
	CPUUse    string `json:"cpuUse,omitempty"`
	MemUse    string `json:"memUse,omitempty"`
	CPUPct    string `json:"cpuPct,omitempty"`
	MemPct    string `json:"memPct,omitempty"`
	PodsLimit string `json:"podsLimit"`
}

func (s *server) handleK8s(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	res := map[string]any{"installed": k3sInstalled()}
	if !k3sInstalled() {
		writeJSON(w, http.StatusOK, res)
		return
	}
	res["running"] = exec.CommandContext(ctx, "systemctl", "is-active", "--quiet", "k3s").Run() == nil
	out, _, err := kubectl(ctx, "", "get", "nodes", "-o", "json")
	if err != nil {
		res["error"] = err.Error()
		writeJSON(w, http.StatusOK, res)
		return
	}
	var list struct {
		Items []struct {
			Metadata struct {
				Name   string            `json:"name"`
				Labels map[string]string `json:"labels"`
			} `json:"metadata"`
			Status struct {
				Capacity   map[string]string `json:"capacity"`
				Conditions []struct {
					Type, Status string
				} `json:"conditions"`
				Addresses []struct {
					Type, Address string
				} `json:"addresses"`
				NodeInfo struct {
					KubeletVersion          string `json:"kubeletVersion"`
					OSImage                 string `json:"osImage"`
					ContainerRuntimeVersion string `json:"containerRuntimeVersion"`
				} `json:"nodeInfo"`
			} `json:"status"`
		} `json:"items"`
	}
	_ = json.Unmarshal(out, &list)
	usage := map[string][]string{}
	if top, _, err := kubectl(ctx, "", "top", "nodes", "--no-headers"); err == nil {
		for _, line := range strings.Split(string(top), "\n") {
			if f := strings.Fields(line); len(f) >= 5 {
				usage[f[0]] = f[1:5]
			}
		}
	}
	var nodes []k8sNode
	for _, it := range list.Items {
		n := k8sNode{Name: it.Metadata.Name, Version: it.Status.NodeInfo.KubeletVersion, OS: it.Status.NodeInfo.OSImage,
			Runtime: it.Status.NodeInfo.ContainerRuntimeVersion, CPU: it.Status.Capacity["cpu"], Memory: it.Status.Capacity["memory"],
			PodsLimit: it.Status.Capacity["pods"]}
		for _, c := range it.Status.Conditions {
			if c.Type == "Ready" {
				n.Ready = c.Status == "True"
			}
		}
		for _, a := range it.Status.Addresses {
			// Dual-stack nodes list an IPv6 address too; the IPv4 one is the one people type.
			if a.Type == "InternalIP" && (n.IP == "" || strings.Contains(n.IP, ":")) {
				n.IP = a.Address
			}
		}
		var roles []string
		for k := range it.Metadata.Labels {
			if role, ok := strings.CutPrefix(k, "node-role.kubernetes.io/"); ok {
				roles = append(roles, role)
			}
		}
		sort.Strings(roles)
		n.Roles = strings.Join(roles, ", ")
		if u := usage[n.Name]; u != nil {
			n.CPUUse, n.CPUPct, n.MemUse, n.MemPct = u[0], u[1], u[2], u[3]
		}
		nodes = append(nodes, n)
	}
	res["nodes"] = nodes
	if ns, _, err := kubectl(ctx, "", "get", "namespaces", "-o", "jsonpath={.items[*].metadata.name}"); err == nil {
		res["namespaces"] = strings.Fields(string(ns))
	}
	writeJSON(w, http.StatusOK, res)
}

// The install script is k3s's official one. Traefik is left out so k3s doesn't take port 80
// from CasaOS; apps are reached through NodePorts (30000–32767) instead.
const k3sInstallScript = `set -e
echo "Downloading and installing k3s (lightweight Kubernetes)…"
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server --disable traefik --write-kubeconfig-mode 600" sh -s -
echo "Waiting for the node to be ready…"
for i in $(seq 1 60); do
  if k3s kubectl get nodes 2>/dev/null | grep -q " Ready"; then k3s kubectl get nodes; echo "Kubernetes is ready."; exit 0; fi
  sleep 2
done
echo "k3s is installed but the node isn't ready yet; check Log Viewer → k3s.service."
`

func (s *server) handleK8sInstall(w http.ResponseWriter, r *http.Request) {
	if k3sInstalled() {
		writeError(w, http.StatusConflict, "Kubernetes (k3s) is already installed.")
		return
	}
	if _, err := startJob("k8s", "Installing Kubernetes (k3s)", nil, nil, "bash", "-c", k3sInstallScript); err != nil {
		writeJobError(w, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func (s *server) handleK8sUninstall(w http.ResponseWriter, r *http.Request) {
	if _, err := os.Stat(k3sUninstall); err != nil {
		writeError(w, http.StatusNotFound, "k3s isn’t installed")
		return
	}
	if _, err := startJob("k8s", "Removing Kubernetes (k3s)", nil, nil, k3sUninstall); err != nil {
		writeJobError(w, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

// ----- Resources -----

type k8sObject struct {
	Metadata struct {
		Name              string            `json:"name"`
		Namespace         string            `json:"namespace"`
		CreationTimestamp string            `json:"creationTimestamp"`
		Labels            map[string]string `json:"labels"`
		OwnerReferences   []struct {
			Kind string `json:"kind"`
			Name string `json:"name"`
		} `json:"ownerReferences"`
	} `json:"metadata"`
	Kind string          `json:"kind"`
	Spec json.RawMessage `json:"spec"`
	Raw  json.RawMessage `json:"status"`
}

type k8sWorkload struct {
	Kind      string   `json:"kind"`
	Name      string   `json:"name"`
	Namespace string   `json:"namespace"`
	Desired   int      `json:"desired"`
	Ready     int      `json:"ready"`
	Updated   int      `json:"updated"`
	Images    []string `json:"images"`
	Created   string   `json:"created"`
	Strategy  string   `json:"strategy,omitempty"`
}

type k8sPod struct {
	Name       string   `json:"name"`
	Namespace  string   `json:"namespace"`
	Phase      string   `json:"phase"`
	Status     string   `json:"status"`
	Ready      string   `json:"ready"`
	Restarts   int      `json:"restarts"`
	Node       string   `json:"node"`
	IP         string   `json:"ip"`
	Owner      string   `json:"owner,omitempty"`
	Created    string   `json:"created"`
	CPU        string   `json:"cpu,omitempty"`
	Memory     string   `json:"memory,omitempty"`
	Containers []string `json:"containers"`
}

type k8sService struct {
	Name      string            `json:"name"`
	Namespace string            `json:"namespace"`
	Type      string            `json:"type"`
	ClusterIP string            `json:"clusterIP"`
	Ports     []k8sPort         `json:"ports"`
	Selector  map[string]string `json:"selector,omitempty"`
	Created   string            `json:"created"`
}

type k8sPort struct {
	Name       string `json:"name,omitempty"`
	Port       int    `json:"port"`
	TargetPort string `json:"targetPort"`
	NodePort   int    `json:"nodePort,omitempty"`
	Protocol   string `json:"protocol"`
}

type k8sVolume struct {
	Name         string `json:"name"`
	Namespace    string `json:"namespace"`
	Status       string `json:"status"`
	Capacity     string `json:"capacity"`
	StorageClass string `json:"storageClass"`
	Volume       string `json:"volume"`
	Created      string `json:"created"`
}

type k8sEvent struct {
	Type      string `json:"type"`
	Reason    string `json:"reason"`
	Object    string `json:"object"`
	Message   string `json:"message"`
	Count     int    `json:"count"`
	Last      string `json:"last"`
	Namespace string `json:"namespace"`
}

func validNamespace(ns string) (string, bool) {
	if ns == "" || ns == "*" {
		return "", true // all namespaces
	}
	return ns, k8sName.MatchString(ns)
}

func nsArgs(ns string) []string {
	if ns == "" {
		return []string{"--all-namespaces"}
	}
	return []string{"-n", ns}
}

func (s *server) handleK8sResources(w http.ResponseWriter, r *http.Request) {
	ns, ok := validNamespace(r.URL.Query().Get("namespace"))
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid namespace")
		return
	}
	if !k3sInstalled() {
		writeError(w, http.StatusNotFound, "Kubernetes isn’t installed")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	out, shown, err := kubectl(ctx, "", append([]string{"get", "deployments,statefulsets,daemonsets,pods,services,pvc", "-o", "json"}, nsArgs(ns)...)...)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	var list struct {
		Items []k8sObject `json:"items"`
	}
	if err := json.Unmarshal(out, &list); err != nil {
		writeError(w, http.StatusBadGateway, "unreadable kubectl output")
		return
	}
	metrics := map[string][2]string{}
	if top, _, err := kubectl(ctx, "", append([]string{"top", "pods", "--no-headers"}, nsArgs(ns)...)...); err == nil {
		for _, line := range strings.Split(string(top), "\n") {
			f := strings.Fields(line)
			switch {
			case ns == "" && len(f) >= 4:
				metrics[f[0]+"/"+f[1]] = [2]string{f[2], f[3]}
			case ns != "" && len(f) >= 3:
				metrics[ns+"/"+f[0]] = [2]string{f[1], f[2]}
			}
		}
	}

	workloads, pods, services, volumes := []k8sWorkload{}, []k8sPod{}, []k8sService{}, []k8sVolume{}
	for _, o := range list.Items {
		switch o.Kind {
		case "Deployment", "StatefulSet", "DaemonSet":
			workloads = append(workloads, workloadOf(o))
		case "Pod":
			p := podOf(o)
			if m, ok := metrics[p.Namespace+"/"+p.Name]; ok {
				p.CPU, p.Memory = m[0], m[1]
			}
			pods = append(pods, p)
		case "Service":
			services = append(services, serviceOf(o))
		case "PersistentVolumeClaim":
			volumes = append(volumes, volumeOf(o))
		}
	}

	events := []k8sEvent{}
	if ev, _, err := kubectl(ctx, "", append([]string{"get", "events", "-o", "json"}, nsArgs(ns)...)...); err == nil {
		var evl struct {
			Items []struct {
				Type, Reason, Message string
				Count                 int    `json:"count"`
				LastTimestamp         string `json:"lastTimestamp"`
				EventTime             string `json:"eventTime"`
				Metadata              struct {
					Namespace         string `json:"namespace"`
					CreationTimestamp string `json:"creationTimestamp"`
				} `json:"metadata"`
				Involved struct {
					Kind, Name string
				} `json:"involvedObject"`
			} `json:"items"`
		}
		_ = json.Unmarshal(ev, &evl)
		for _, e := range evl.Items {
			last := e.LastTimestamp
			if last == "" {
				last = e.EventTime
			}
			if last == "" {
				last = e.Metadata.CreationTimestamp
			}
			events = append(events, k8sEvent{Type: e.Type, Reason: e.Reason, Object: strings.ToLower(e.Involved.Kind) + "/" + e.Involved.Name,
				Message: e.Message, Count: max(e.Count, 1), Last: last, Namespace: e.Metadata.Namespace})
		}
		sort.Slice(events, func(i, j int) bool { return events[i].Last > events[j].Last })
		if len(events) > 200 {
			events = events[:200]
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"workloads": workloads, "pods": pods, "services": services, "volumes": volumes, "events": events, "command": shown,
	})
}

func workloadOf(o k8sObject) k8sWorkload {
	w := k8sWorkload{Kind: o.Kind, Name: o.Metadata.Name, Namespace: o.Metadata.Namespace, Created: o.Metadata.CreationTimestamp}
	var spec struct {
		Replicas *int `json:"replicas"`
		Strategy struct {
			Type string `json:"type"`
		} `json:"strategy"`
		Template struct {
			Spec struct {
				Containers []struct {
					Image string `json:"image"`
				} `json:"containers"`
			} `json:"spec"`
		} `json:"template"`
	}
	_ = json.Unmarshal(o.Spec, &spec)
	var st struct {
		Replicas, ReadyReplicas, UpdatedReplicas                    int
		DesiredNumberScheduled, NumberReady, UpdatedNumberScheduled int
	}
	_ = json.Unmarshal(o.Raw, &st)
	for _, c := range spec.Template.Spec.Containers {
		w.Images = append(w.Images, c.Image)
	}
	w.Strategy = spec.Strategy.Type
	if o.Kind == "DaemonSet" {
		w.Desired, w.Ready, w.Updated = st.DesiredNumberScheduled, st.NumberReady, st.UpdatedNumberScheduled
	} else {
		w.Desired, w.Ready, w.Updated = st.Replicas, st.ReadyReplicas, st.UpdatedReplicas
		if spec.Replicas != nil {
			w.Desired = *spec.Replicas
		}
	}
	return w
}

func podOf(o k8sObject) k8sPod {
	p := k8sPod{Name: o.Metadata.Name, Namespace: o.Metadata.Namespace, Created: o.Metadata.CreationTimestamp, Containers: []string{}}
	if len(o.Metadata.OwnerReferences) > 0 {
		p.Owner = o.Metadata.OwnerReferences[0].Kind + "/" + o.Metadata.OwnerReferences[0].Name
	}
	var spec struct {
		NodeName   string `json:"nodeName"`
		Containers []struct {
			Name string `json:"name"`
		} `json:"containers"`
	}
	_ = json.Unmarshal(o.Spec, &spec)
	p.Node = spec.NodeName
	for _, c := range spec.Containers {
		p.Containers = append(p.Containers, c.Name)
	}
	var st struct {
		Phase      string `json:"phase"`
		PodIP      string `json:"podIP"`
		Reason     string `json:"reason"`
		Containers []struct {
			Ready        bool `json:"ready"`
			RestartCount int  `json:"restartCount"`
			State        map[string]struct {
				Reason string `json:"reason"`
			} `json:"state"`
		} `json:"containerStatuses"`
	}
	_ = json.Unmarshal(o.Raw, &st)
	p.Phase, p.IP, p.Status = st.Phase, st.PodIP, st.Phase
	if st.Reason != "" {
		p.Status = st.Reason
	}
	ready := 0
	for _, c := range st.Containers {
		if c.Ready {
			ready++
		}
		p.Restarts += c.RestartCount
		// A waiting container's reason (CrashLoopBackOff, ImagePullBackOff…) is what matters.
		for state, detail := range c.State {
			if state != "running" && detail.Reason != "" {
				p.Status = detail.Reason
			}
		}
	}
	p.Ready = fmt.Sprintf("%d/%d", ready, len(p.Containers))
	return p
}

func serviceOf(o k8sObject) k8sService {
	s := k8sService{Name: o.Metadata.Name, Namespace: o.Metadata.Namespace, Created: o.Metadata.CreationTimestamp, Ports: []k8sPort{}}
	var spec struct {
		Type      string            `json:"type"`
		ClusterIP string            `json:"clusterIP"`
		Selector  map[string]string `json:"selector"`
		Ports     []struct {
			Name       string `json:"name"`
			Port       int    `json:"port"`
			TargetPort any    `json:"targetPort"`
			NodePort   int    `json:"nodePort"`
			Protocol   string `json:"protocol"`
		} `json:"ports"`
	}
	_ = json.Unmarshal(o.Spec, &spec)
	s.Type, s.ClusterIP, s.Selector = spec.Type, spec.ClusterIP, spec.Selector
	for _, p := range spec.Ports {
		s.Ports = append(s.Ports, k8sPort{Name: p.Name, Port: p.Port, TargetPort: fmt.Sprint(p.TargetPort), NodePort: p.NodePort, Protocol: p.Protocol})
	}
	return s
}

func volumeOf(o k8sObject) k8sVolume {
	v := k8sVolume{Name: o.Metadata.Name, Namespace: o.Metadata.Namespace, Created: o.Metadata.CreationTimestamp}
	var spec struct {
		StorageClassName string `json:"storageClassName"`
		VolumeName       string `json:"volumeName"`
		Resources        struct {
			Requests map[string]string `json:"requests"`
		} `json:"resources"`
	}
	_ = json.Unmarshal(o.Spec, &spec)
	var st struct {
		Phase    string            `json:"phase"`
		Capacity map[string]string `json:"capacity"`
	}
	_ = json.Unmarshal(o.Raw, &st)
	v.Status, v.StorageClass, v.Volume = st.Phase, spec.StorageClassName, spec.VolumeName
	v.Capacity = st.Capacity["storage"]
	if v.Capacity == "" {
		v.Capacity = spec.Resources.Requests["storage"]
	}
	return v
}

// ----- Actions -----

type k8sAction struct {
	Action    string `json:"action"` // apply, delete, scale, restart, image, namespace, deleteNamespace
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Replicas  int    `json:"replicas"`
	Container string `json:"container"`
	Image     string `json:"image"`
	YAML      string `json:"yaml"`
}

var imageName = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,254}$`)

func (s *server) handleK8sAction(w http.ResponseWriter, r *http.Request) {
	var a k8sAction
	if decodeJSON(r, &a) != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if !k3sInstalled() {
		writeError(w, http.StatusNotFound, "Kubernetes isn’t installed")
		return
	}
	ns, ok := validNamespace(a.Namespace)
	if !ok || (a.Name != "" && !k8sName.MatchString(a.Name)) {
		writeError(w, http.StatusBadRequest, "names are lowercase letters, numbers and dashes")
		return
	}
	kind := k8sKinds[strings.ToLower(a.Kind)]
	if ns == "" && a.Action != "apply" && a.Action != "namespace" && a.Action != "deleteNamespace" {
		ns = "default"
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()
	var args []string
	stdin := ""
	switch a.Action {
	case "apply":
		if strings.TrimSpace(a.YAML) == "" || len(a.YAML) > 1<<20 {
			writeError(w, http.StatusBadRequest, "paste a manifest to apply")
			return
		}
		args, stdin = []string{"apply", "-f", "-"}, a.YAML
		if ns != "" {
			args = append(args, "-n", ns)
		}
	case "delete":
		if kind == "" || a.Name == "" {
			writeError(w, http.StatusBadRequest, "what should be deleted?")
			return
		}
		args = []string{"delete", kind, a.Name, "-n", ns, "--wait=false"}
	case "scale":
		if kind != "deployment" && kind != "statefulset" {
			writeError(w, http.StatusBadRequest, "only deployments and statefulsets scale")
			return
		}
		if a.Replicas < 0 || a.Replicas > 20 {
			writeError(w, http.StatusBadRequest, "replicas go from 0 to 20 here")
			return
		}
		args = []string{"scale", kind, a.Name, "-n", ns, "--replicas=" + strconv.Itoa(a.Replicas)}
	case "restart":
		if kind != "deployment" && kind != "statefulset" && kind != "daemonset" {
			writeError(w, http.StatusBadRequest, "only workloads restart")
			return
		}
		args = []string{"rollout", "restart", kind, a.Name, "-n", ns}
	case "image":
		if kind != "deployment" && kind != "statefulset" && kind != "daemonset" {
			writeError(w, http.StatusBadRequest, "only workloads have images")
			return
		}
		if !k8sName.MatchString(a.Container) || !imageName.MatchString(a.Image) {
			writeError(w, http.StatusBadRequest, "invalid container or image")
			return
		}
		args = []string{"set", "image", kind + "/" + a.Name, a.Container + "=" + a.Image, "-n", ns}
	case "undo":
		args = []string{"rollout", "undo", kind, a.Name, "-n", ns}
	case "namespace":
		if a.Name == "" {
			writeError(w, http.StatusBadRequest, "name the namespace")
			return
		}
		args = []string{"create", "namespace", a.Name}
	case "deleteNamespace":
		if a.Name == "" || a.Name == "default" || strings.HasPrefix(a.Name, "kube-") {
			writeError(w, http.StatusForbidden, "system namespaces can’t be deleted")
			return
		}
		args = []string{"delete", "namespace", a.Name, "--wait=false"}
	default:
		writeError(w, http.StatusBadRequest, "unknown action")
		return
	}
	out, shown, err := kubectl(ctx, stdin, args...)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error(), "command": shown})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"output": strings.TrimSpace(string(out)), "command": shown})
}

// handleK8sText serves logs, describe and YAML: the read-only views that explain a resource.
func (s *server) handleK8sText(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	ns, ok := validNamespace(q.Get("namespace"))
	name := q.Get("name")
	if !ok || !k8sName.MatchString(name) {
		writeError(w, http.StatusBadRequest, "invalid name")
		return
	}
	if ns == "" {
		ns = "default"
	}
	kind := k8sKinds[strings.ToLower(q.Get("kind"))]
	var args []string
	switch r.PathValue("view") {
	case "logs":
		tail, _ := strconv.Atoi(q.Get("tail"))
		if tail <= 0 || tail > 5000 {
			tail = 300
		}
		args = []string{"logs", name, "-n", ns, "--tail=" + strconv.Itoa(tail), "--all-containers=true", "--prefix=true"}
		if q.Get("previous") == "1" {
			args = append(args, "--previous")
		}
	case "describe":
		if kind == "" {
			writeError(w, http.StatusBadRequest, "unknown kind")
			return
		}
		args = []string{"describe", kind, name, "-n", ns}
	case "yaml":
		if kind == "" {
			writeError(w, http.StatusBadRequest, "unknown kind")
			return
		}
		args = []string{"get", kind, name, "-n", ns, "-o", "yaml"}
	default:
		http.NotFound(w, r)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	out, shown, err := kubectl(ctx, "", args...)
	text := string(out)
	if err != nil {
		text = strings.TrimSpace(text + "\n" + err.Error())
	}
	writeJSON(w, http.StatusOK, map[string]string{"text": text, "command": shown})
}

// handleK8sRollout reports a rollout's progress (kubectl rollout status), for rolling updates.
func (s *server) handleK8sRollout(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	ns, name := q.Get("namespace"), q.Get("name")
	if !k8sName.MatchString(ns) || !k8sName.MatchString(name) {
		writeError(w, http.StatusBadRequest, "invalid name")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	out, shown, _ := kubectl(ctx, "", "rollout", "history", "deployment", name, "-n", ns)
	var revisions []string
	scanner := bufio.NewScanner(bytes.NewReader(out))
	for scanner.Scan() {
		if line := strings.TrimSpace(scanner.Text()); line != "" && !strings.HasPrefix(line, "deployment") && !strings.HasPrefix(line, "REVISION") {
			revisions = append(revisions, line)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"revisions": revisions, "command": shown})
}
