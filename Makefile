# Labby monorepo — root Makefile. `make help` is the default target.
# Sub-projects are skipped gracefully until their scaffolding ticket lands:
# a directory participates once it has its own Makefile (backend) or package.json (apps).

SUBPROJECTS := backend apps/admin apps/rider apps/driver

.DEFAULT_GOAL := help

.PHONY: help check test build \
        backend-check backend-test backend-build \
        admin-check admin-test admin-build \
        rider-check rider-test rider-build \
        driver-check driver-test driver-build

help: ## Show this help
	@echo "Labby — root targets:"
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Per-project: backend-check|test|build, admin-…, rider-…, driver-…"

# Run a make target in a dir if it has a Makefile; else a npm script if package.json; else skip.
define run_in
	@if [ -f $(1)/Makefile ]; then \
		$(MAKE) -C $(1) $(2); \
	elif [ -f $(1)/package.json ]; then \
		cd $(1) && npm run --if-present $(2); \
	else \
		echo "skip: $(1) (not scaffolded yet)"; \
	fi
endef

check: ## Run checks (format/lint/tests) in every scaffolded sub-project
	$(call run_in,backend,check)
	$(call run_in,apps/admin,check)
	$(call run_in,apps/rider,check)
	$(call run_in,apps/driver,check)

test: ## Run tests in every scaffolded sub-project
	$(call run_in,backend,test)
	$(call run_in,apps/admin,test)
	$(call run_in,apps/rider,test)
	$(call run_in,apps/driver,test)

build: ## Build every scaffolded sub-project
	$(call run_in,backend,build)
	$(call run_in,apps/admin,build)
	$(call run_in,apps/rider,build)
	$(call run_in,apps/driver,build)

backend-check: ; $(call run_in,backend,check) ## Backend checks
backend-test: ; $(call run_in,backend,test) ## Backend tests
backend-build: ; $(call run_in,backend,build) ## Backend build
admin-check: ; $(call run_in,apps/admin,check) ## Admin checks
admin-test: ; $(call run_in,apps/admin,test) ## Admin tests
admin-build: ; $(call run_in,apps/admin,build) ## Admin build
rider-check: ; $(call run_in,apps/rider,check) ## Rider checks
rider-test: ; $(call run_in,apps/rider,test) ## Rider tests
rider-build: ; $(call run_in,apps/rider,build) ## Rider build
driver-check: ; $(call run_in,apps/driver,check) ## Driver checks
driver-test: ; $(call run_in,apps/driver,test) ## Driver tests
driver-build: ; $(call run_in,apps/driver,build) ## Driver build
