"""Fallback LLM provider — OpenAI direct, or OpenRouter.

WHY: Gemini's free tier has hard per-minute and per-day caps. When a Gemini
call is rate-limited or erroring, the vision and synthesis stages fail over to
this module so a job still completes with real notes instead of returning
error placeholders.

Both OpenAI and OpenRouter expose the same OpenAI-style Chat Completions API,
so this only needs httpx — no extra SDK. Provider precedence: if OPENAI_API_KEY
is set, OpenAI is used directly; otherwise OpenRouter. The fallback is disabled
(helpers return None / False) when neither key is configured.
"""

import logging

import httpx

from config import (
    OPENAI_API_KEY,
    OPENAI_MODEL,
    OPENROUTER_API_KEY,
    OPENROUTER_MODEL,
)

logger = logging.getLogger(__name__)

_OPENAI_URL = "https://api.openai.com/v1/chat/completions"
_OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
_TIMEOUT = 120.0  # seconds — vision calls with several images can be slow


def _provider() -> tuple[str, str, str] | None:
    """Return (url, api_key, model) for the active fallback provider.

    OpenAI takes precedence over OpenRouter. Returns None when no fallback
    provider is configured.
    """
    if OPENAI_API_KEY:
        return _OPENAI_URL, OPENAI_API_KEY, OPENAI_MODEL
    if OPENROUTER_API_KEY:
        return _OPENROUTER_URL, OPENROUTER_API_KEY, OPENROUTER_MODEL
    return None


def fallback_available() -> bool:
    """True when a fallback provider (OpenAI or OpenRouter) is configured."""
    return _provider() is not None


async def _chat(messages: list[dict], max_tokens: int, temperature: float) -> str:
    """Call the active provider's chat-completions endpoint; return the text.

    Raises httpx.HTTPError on transport/HTTP failure or KeyError on an
    unexpected response shape — callers treat any exception as "fallback failed".
    """
    provider = _provider()
    if provider is None:
        raise RuntimeError("No fallback provider configured.")
    url, api_key, model = provider

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(url, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
    return data["choices"][0]["message"]["content"]


async def vision_fallback(
    prompt_text: str,
    frames: list[tuple[str, str]],
) -> str:
    """Run one vision batch via OpenRouter; return the raw JSON response text.

    `frames` is a list of (frame_text, image_base64) pairs in frame order. Each
    image is embedded as a data URL, matching how the Gemini path sends it.
    """
    content: list[dict] = [{"type": "text", "text": prompt_text}]
    for frame_text, image_base64 in frames:
        content.append({"type": "text", "text": frame_text})
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"},
            }
        )
    messages = [{"role": "user", "content": content}]
    return await _chat(messages, max_tokens=4000, temperature=0.1)


async def synthesis_fallback(prompt: str) -> str:
    """Run the synthesis prompt via OpenRouter; return the raw JSON response text."""
    messages = [{"role": "user", "content": prompt}]
    return await _chat(messages, max_tokens=16000, temperature=0.2)
