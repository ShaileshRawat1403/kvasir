PYTHON := python3
VENV := .venv
VENV_BIN := $(VENV)/bin
PIP := $(VENV_BIN)/pip
PY_API_PORT ?= 8000
NODE ?= node

.PHONY: venv install demo frontend-install frontend-dev frontend-build clean-memory \
	backend-install backend-start backend-stop python-api-start python-api-stop dev-help \
	v pi d fi fd fb cm bi bs pa bstop pstop

venv: $(VENV)/bin/activate
$(VENV)/bin/activate:
	$(PYTHON) -m venv $(VENV)
	$(PIP) install --upgrade pip

install: venv
	$(PIP) install -r requirements.txt

demo: install
	$(VENV_BIN)/python run_demo.py

frontend-install:
	npm --prefix frontend install

frontend-dev: frontend-install
	npm --prefix frontend run dev

frontend-build: frontend-install
	npm --prefix frontend run build

clean-memory:
	rm -rf kvasir_memory

# Backend (Node proxy to Ollama)
backend-install:
	npm install

backend-start:
	@echo "Starting Node proxy on PORT=$${PORT:-3030} (reads .env)..."
	$(NODE) server.js

backend-stop:
	@echo "Stopping Node proxy (matching 'node server.js')..."
	-@pkill -f "node server.js" || true

# Python FastAPI (knowledge brain)
python-api-start: install
	@echo "Starting Python API on port $(PY_API_PORT) (loading .env)..."
	@set -a; . .env; set +a; \
	$(VENV_BIN)/uvicorn python_api:app --host 0.0.0.0 --port $(PY_API_PORT)

python-api-stop:
	@echo "Stopping Python API (matching 'uvicorn python_api:app')..."
	-@pkill -f "uvicorn python_api:app" || true

dev-help:
	@echo "Use three terminals:"
	@echo "1) make python-api-start"
	@echo "2) make backend-start   # Node proxy"
	@echo "3) make frontend-dev    # Vite dev server"

# Short aliases
v: venv
pi: install
d: demo
fi: frontend-install
fd: frontend-dev
fb: frontend-build
cm: clean-memory
bi: backend-install
bs: backend-start
pa: python-api-start
bstop: backend-stop
pstop: python-api-stop
