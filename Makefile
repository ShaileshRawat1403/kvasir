PYTHON := python3
VENV := .venv
VENV_BIN := $(VENV)/bin
PIP := $(VENV_BIN)/pip
PY_API_PORT ?= 8000

.PHONY: venv install demo frontend-install frontend-dev frontend-build clean-memory \
	backend-install backend-start python-api-start \
	v pi d fi fd fb cm bi bs pa

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
	npm start

# Python FastAPI (knowledge brain)
python-api-start: install
	$(VENV_BIN)/uvicorn python_api:app --host 0.0.0.0 --port $(PY_API_PORT)

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
