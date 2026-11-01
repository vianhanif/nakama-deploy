.PHONY: help build up down logs shell validate reset status test \
        local-init local-build local-up local-down local-restart local-logs local-status local-test

IMAGE_NAME ?= nakama:local
NAMESPACE  := nakama
KUBE_CONTEXT ?= colima
KUBECTL    := kubectl --context $(KUBE_CONTEXT)

help:
	@echo "nakama-deploy"
	@echo ""
	@echo "  make validate   kustomize build + dry-run (no cluster changes)"
	@echo "  make build      build image from fork (NAKAMA_VERSION=<ref> to pin)"
	@echo "  make up         apply manifests to current kube-context"
	@echo "  make test       health check + persistence check"
	@echo "  make logs       follow deployment logs"
	@echo "  make shell      exec into the running pod"
	@echo "  make down       delete all resources (keeps PVC)"
	@echo "  make reset      delete resources AND data"
	@echo ""
	@echo "Native daily driver (pm2, no Docker — ~250 MB idle)"
	@echo "  make local-init     create ~/Data/nakama + secret (idempotent)"
	@echo "  make local-build    bun install + build bundles from the fork"
	@echo "  make local-up       pm2 start (namespace: nakama)"
	@echo "  make local-down     pm2 delete"
	@echo "  make local-restart  pm2 restart"
	@echo "  make local-logs     pm2 logs"
	@echo "  make local-status   pm2 describe"
	@echo "  make local-test     health check on :4310"
	@echo ""
	@echo "Context: $$($(KUBECTL) config current-context)"

validate:
	@echo "[validate] rendering manifests"
	kustomize build overlays/local > /tmp/nakama-manifest.yaml
	@echo "[validate] server dry-run"
	$(KUBECTL) apply -f /tmp/nakama-manifest.yaml --dry-run=client -o name
	@echo "[validate] OK"

build:
	@echo "[build] from fork, ref=$(NAKAMA_VERSION)"
	docker buildx build --load --target runtime \
		--build-arg NAKAMA_VERSION=$(or $(NAKAMA_VERSION),main) \
		-f src/nakama/Dockerfile -t $(IMAGE_NAME) .
	@echo "[build] OK -> $(IMAGE_NAME)"

up:
	@echo "[up] applying to context: $$($(KUBECTL) config current-context)"
	kustomize build overlays/local | $(KUBECTL) apply -f -
	$(KUBECTL) -n $(NAMESPACE) rollout status deploy/nakama --timeout=180s

down:
	kustomize build overlays/local | $(KUBECTL) delete -f - --ignore-not-found

reset:
	@echo "[reset] deleting namespace — this destroys the SQLite volume"
	$(KUBECTL) delete namespace $(NAMESPACE) --ignore-not-found

status:
	$(KUBECTL) -n $(NAMESPACE) get deploy,pod,svc,pvc

logs:
	$(KUBECTL) -n $(NAMESPACE) logs -f deploy/nakama

shell:
	$(KUBECTL) -n $(NAMESPACE) exec -it deploy/nakama -- sh

# The only test that proves "deployable": data must survive a pod restart.
test:
	@echo "[test] port-forward 4310"
	@pkill -f "port-forward svc/nakama" 2>/dev/null || true
	@$(KUBECTL) -n $(NAMESPACE) port-forward svc/nakama 4310:4310 >/dev/null 2>&1 & sleep 4
	@echo -n "[test] health: "; curl -fsS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4310/health
	@echo "[test] writing marker into the data volume"
	@$(KUBECTL) -n $(NAMESPACE) exec deploy/nakama -- sh -c 'date > /nakama/data/.persistence-marker'
	@echo "[test] restarting pod"
	@$(KUBECTL) -n $(NAMESPACE) delete pod -l app.kubernetes.io/name=nakama
	@$(KUBECTL) -n $(NAMESPACE) rollout status deploy/nakama --timeout=180s
	@echo -n "[test] marker after restart: "
	@$(KUBECTL) -n $(NAMESPACE) exec deploy/nakama -- cat /nakama/data/.persistence-marker
	@echo "[test] re-establishing port-forward (the old one dies with the pod)"
	@pkill -f "port-forward svc/nakama" 2>/dev/null || true
	@$(KUBECTL) -n $(NAMESPACE) port-forward svc/nakama 4310:4310 >/dev/null 2>&1 & sleep 5
	@echo -n "[test] health after restart: "; curl -fsS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4310/health
	@echo "[test] PASS"

# ---------------------------------------------------------------------------
# Native daily driver (pm2, no Docker)
#
# Same fork and same NAKAMA_VERSION as the image build, so the two runtimes
# cannot drift. Data + secret live in ~/Data/nakama, outside the repo.
# ---------------------------------------------------------------------------
PM2_CONFIG := scripts/pm2/ecosystem.nakama.config.js
PORT_LOCAL ?= 4310

local-init:
	@bash scripts/local-init.sh

local-build:
	@NAKAMA_VERSION=$(or $(NAKAMA_VERSION),main) bash scripts/local-build.sh

local-up: local-init
	@pm2 start $(PM2_CONFIG) --update-env
	@sleep 3
	@$(MAKE) --no-print-directory local-test

local-down:
	@pm2 delete nakama 2>/dev/null || true
	@# Nakama's server supervises an `automation` worker via pm2 itself, so it
	@# lands in the shared daemon's default namespace. Clean it up too.
	@pm2 delete automation 2>/dev/null || true

local-restart:
	@pm2 restart nakama --update-env
	@sleep 3
	@$(MAKE) --no-print-directory local-test

local-logs:
	@pm2 logs nakama

local-status:
	@pm2 describe nakama

local-test:
	@printf '[local-test] health: '
	@curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:$(PORT_LOCAL)/health || \
		{ echo "FAIL — check 'make local-logs'"; exit 1; }
