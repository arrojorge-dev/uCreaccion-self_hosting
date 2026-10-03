FROM nousresearch/hermes-agent:v2026.7.20

RUN apt-get update \
    && apt-get install -y --no-install-recommends sudo patch \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /etc/sudoers.d \
    && printf 'hermes ALL=(ALL) NOPASSWD: ALL\n' > /etc/sudoers.d/hermes \
    && chmod 0440 /etc/sudoers.d/hermes \
    && chown root:root /etc/sudoers.d/hermes

#COPY docker/patches/ /tmp/patches/
#RUN cd /opt/hermes \
#    && for p in /tmp/patches/*.patch; do patch -p1 < "$p"; done \
#    && rm -rf /tmp/patches

RUN set -eu; \
    /opt/hermes/.venv/bin/python3 -m ensurepip --upgrade; \
    /opt/hermes/.venv/bin/python3 -m pip install --quiet --upgrade pip; \
    /opt/hermes/.venv/bin/python3 -m pip uninstall -y --quiet fpdf 2>/dev/null || true; \
    /opt/hermes/.venv/bin/python3 -m pip install --quiet --force-reinstall --no-cache-dir fpdf2; \
    /opt/hermes/.venv/bin/python3 -m pip install --quiet --no-cache-dir fpdf2 weasyprint ddgs beautifulsoup4 markdown pdfminer.six numpy; \
    /opt/hermes/.venv/bin/python3 -m pip install --quiet --no-cache-dir "Pillow==12.2.0" 2>/dev/null || true; \
    chown -R hermes:hermes /opt/hermes/.venv

# Asegura que el venv de hermes esté en el PATH de los login shells del agente
# (la terminal tool ejecuta `bash -lic`, que recalcula PATH desde /etc/profile
# y sin esto perdería /opt/hermes/.venv/bin → `pip` y los paquetes no estarían
# disponibles en los comandos del agente).
RUN printf 'export PATH="/opt/hermes/.venv/bin:$PATH"\n' > /etc/profile.d/hermes-venv.sh \
    && chmod 0644 /etc/profile.d/hermes-venv.sh
