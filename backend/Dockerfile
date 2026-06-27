FROM python:3.11-slim

# ffmpeg for yt-dlp; libgl1 + libglib for OpenCV (headless still needs these).
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# HF Spaces requires a non-root user with uid 1000.
RUN useradd -m -u 1000 user

# Pre-create HuggingFace cache directory with correct permissions
RUN mkdir -p /home/user/.cache/huggingface && chown -R user:user /home/user/.cache

USER user
ENV PATH="/home/user/.local/bin:$PATH"

WORKDIR /home/user/app

COPY --chown=user requirements.txt .

# Install CPU-only PyTorch first (avoids downloading 2GB CUDA version).
# torchvision is required by transformers' AutoImageProcessor for DINOv2.
RUN pip install --no-cache-dir \
    torch torchvision --index-url https://download.pytorch.org/whl/cpu

# Then install the rest (transformers will use the already-installed torch)
RUN pip install --no-cache-dir "transformers>=4.40.0"
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=user . .

EXPOSE 80

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "80"]
