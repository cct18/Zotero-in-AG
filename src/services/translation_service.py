import re
import urllib.parse
from typing import Any, Optional
import httpx

from src.domain.models import TranslateRequest, TestAiRequest
from src.services.validation import normalize_and_validate_chat_endpoint

class TranslationService:
    @staticmethod
    async def execute_translation(req_data: TranslateRequest) -> dict[str, Any]:
        """
        Core translation worker:
        1. If engine == 'custom' and api_key is present:
           - If short word/phrase: still queries Youdao for phonetics & dictionary definitions.
           - Calls the custom AI model (OpenAI-compatible format) for professional academic translation.
        2. If engine == 'builtin' (or no api_key):
           - Words: Youdao dictionary (ec + web_trans) with phonetics.
           - Sentences: Youdao AI Neural Machine Translation with Google fallback.
        """
        cleaned = re.sub(r'(\w+)-\s*\n\s*(\w+)', r'\1\2', req_data.text)
        cleaned = re.sub(r'\s+', ' ', cleaned).strip()
        if not cleaned:
            return {"success": False, "error": "文本为空"}

        words = cleaned.split()
        is_short = len(words) <= 3 and any(c.isalpha() for c in cleaned)

        usphone = ""
        ukphone = ""
        trs_list: list[str] = []

        # 1. Look up phonetics & dictionary entries if short
        if is_short:
            try:
                url = f"https://dict.youdao.com/jsonapi?q={urllib.parse.quote(cleaned)}"
                async with httpx.AsyncClient(timeout=3.0, trust_env=False) as client:
                    resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
                    if resp.status_code == 200:
                        data = resp.json()
                        ec = data.get("ec", {})
                        w_list = ec.get("word", [])
                        if w_list:
                            w = w_list[0]
                            usphone = w.get("usphone") or ""
                            ukphone = w.get("ukphone") or ""
                            for tr in w.get("trs", []):
                                explain = tr.get("tr", [{}])[0].get("l", {}).get("i", [""])[0]
                                if explain:
                                    trs_list.append(explain)

                        if not trs_list and "web_trans" in data:
                            for item in data["web_trans"].get("web-translation", []):
                                vals = [x.get("value") for x in item.get("trans", []) if x.get("value")]
                                k = item.get("key")
                                if vals:
                                    trs_list.append(f"{k}: {', '.join(vals[:3])}")
            except Exception:
                pass

        # 2. Branch A: Custom AI Model Mode
        if req_data.engine == "custom" and req_data.api_key:
            try:
                ai_url = normalize_and_validate_chat_endpoint(req_data.api_base or "")
                headers = {
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {req_data.api_key.strip()}",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                }
                system_prompt = req_data.prompt or "你是一位资深学术审稿专家，请将用户提供的学术英文文本翻译为地道、准确的学术中文，保留专业术语，直接输出翻译结果，不要输出任何多余解释。"
                ai_payload = {
                    "model": req_data.model or "deepseek-chat",
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": cleaned}
                    ],
                    "temperature": 0.3
                }
                async with httpx.AsyncClient(timeout=12.0, trust_env=False) as client:
                    resp = await client.post(ai_url, json=ai_payload, headers=headers)
                    if resp.status_code == 200:
                        res_json = resp.json()
                        ai_text = res_json["choices"][0]["message"]["content"].strip()
                        if ai_text:
                            full_text = ai_text
                            if trs_list and len(trs_list) <= 3:
                                full_text = f"【AI 译文】\n{ai_text}\n\n【词典释义】\n" + "\n".join(trs_list)
                            return {
                                "success": True,
                                "query": cleaned,
                                "is_word": is_short,
                                "usphone": usphone,
                                "ukphone": ukphone,
                                "translation": full_text,
                            }
                    else:
                        return {"success": False, "error": f"自定义 AI 服务返回异常: HTTP {resp.status_code}"}
            except Exception as e:
                return {"success": False, "error": f"自定义 AI 模型调用失败: {str(e)}"}

        # 2. Branch B: Built-in Academic Engine Mode
        if is_short and trs_list:
            return {
                "success": True,
                "query": cleaned,
                "is_word": True,
                "usphone": usphone,
                "ukphone": ukphone,
                "translation": "\n".join(trs_list),
            }

        # Sentence / paragraph translation via Youdao AI Neural Machine Translation
        try:
            async with httpx.AsyncClient(timeout=4.0, trust_env=False) as client:
                resp = await client.post(
                    "https://aidemo.youdao.com/trans",
                    data={"q": cleaned, "from": "Auto", "to": "zh-CHS"},
                    headers={
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                        "Referer": "https://ai.youdao.com/",
                    }
                )
                if resp.status_code == 200:
                    data = resp.json()
                    trans = data.get("translation")
                    if trans and isinstance(trans, list):
                        res_text = "".join(trans).strip()
                        if res_text:
                            return {
                                "success": True,
                                "query": cleaned,
                                "is_word": False,
                                "translation": res_text,
                            }
        except Exception:
            pass

        # Google Translate fallback
        try:
            url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q={urllib.parse.quote(cleaned)}"
            async with httpx.AsyncClient(timeout=2.5, trust_env=False) as client:
                resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
                if resp.status_code == 200:
                    res = resp.json()
                    trans = "".join([part[0] for part in res[0] if part[0]]).strip()
                    if trans:
                        return {
                            "success": True,
                            "query": cleaned,
                            "is_word": False,
                            "translation": trans,
                        }
        except Exception:
            pass

        return {"success": False, "error": "未能获取到释义，请检查网络或稍后重试"}

    @staticmethod
    async def test_ai_model(req: TestAiRequest) -> dict[str, Any]:
        if not req.api_key:
            return {"success": False, "error": "请先输入 API Key"}
        try:
            url = normalize_and_validate_chat_endpoint(req.api_base or "")
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {req.api_key.strip()}",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
            }
            payload = {
                "model": req.model or "deepseek-chat",
                "messages": [{"role": "user", "content": "hi"}],
                "max_tokens": 5
            }
            async with httpx.AsyncClient(timeout=8.0, trust_env=False) as client:
                resp = await client.post(url, json=payload, headers=headers)
                if resp.status_code == 200:
                    return {"success": True, "model": req.model or "deepseek-chat"}
                else:
                    return {"success": False, "error": f"HTTP {resp.status_code}: {resp.text[:100]}"}
        except Exception as e:
            return {"success": False, "error": str(e)}
