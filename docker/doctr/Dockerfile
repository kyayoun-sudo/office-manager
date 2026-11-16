# docTR OCR API (Mindee, Apache-2.0), version fixed — read scanned PDF pages on the firm's own server (2026-11-16).
# Called by lib/tool-gateway.js ocrDocument (POST /ocr/), only from the application's internal Docker network.
# CPU only (no graphics card): PyTorch CPU wheels, models downloaded once at build time.
FROM python:3.11-slim-bookworm

ARG DOCTR_VERSION=1.1.0
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install --no-install-recommends -y curl libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --index-url https://download.pytorch.org/whl/cpu torch torchvision \
    && pip install "python-doctr==${DOCTR_VERSION}" "fastapi>=0.73.0" "uvicorn>=0.11.1" "python-multipart>=0.0.5"

WORKDIR /app
# The API template of the same docTR version (api/app of the tagged release).
RUN curl -fsSL "https://github.com/mindee/doctr/archive/refs/tags/v${DOCTR_VERSION}.tar.gz" \
    | tar -xz --strip-components=2 "doctr-${DOCTR_VERSION}/api/app" \
    && test -f app/main.py

# Pretrained detection + recognition models fetched now, not at the first page of a real mission.
RUN python -c "from doctr.models import ocr_predictor; ocr_predictor(pretrained=True)"

EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
