import os
import time
import logging
import re
import chromadb
import google.generativeai as genai
from google.generativeai.types import HarmCategory, HarmBlockThreshold
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    raise ValueError("GEMINI_API_KEY is not set in .env")

import asyncio

# Retry Helper Loop
async def retry_with_backoff_async(prompt, safety_settings, generation_config=None, system_instruction=None, is_chat=False, history=None):
    max_retries = 3
    base_delay = 2
    current_model = "gemini-2.5-flash"
    
    for attempt in range(max_retries):
        model_kwargs = {"model_name": current_model, "safety_settings": safety_settings}
        if generation_config:
            model_kwargs["generation_config"] = generation_config
        if system_instruction:
            model_kwargs["system_instruction"] = system_instruction
            
        model = genai.GenerativeModel(**model_kwargs)
        
        try:
            if is_chat:
                chat = model.start_chat(history=history)
                return await chat.send_message_async(prompt)
            else:
                return await model.generate_content_async(prompt)
        except Exception as e:
            err_str = str(e).lower()
            if "429" in err_str or "quota" in err_str or "503" in err_str or "exhausted" in err_str:
                # Instantly abort on Hard Daily API Limits to prevent 60-second UX hanging
                if "perday" in err_str:
                    logging.error("Google Gemini Free-Tier Daily Quota Exhausted! Aborting.")
                    raise RuntimeError("API_QUOTA_EXHAUSTED: Google Gemini 2.5 Flash free tier daily limit reached (20 requests max).")

                if attempt == max_retries - 1:
                    raise e
                
                # Check for explicit retry directive from API (Minute limits)
                delay = base_delay * (2 ** attempt)
                match = re.search(r'retry in (\d+(?:\.\d+)?)s', err_str)
                if match:
                    delay = max(delay, float(match.group(1)) + 1.0)
                
                logging.info(f"Rate limited. Waiting {delay}s before retry {attempt + 1}/{max_retries}...")
                await asyncio.sleep(delay)
            else:
                raise e

def retry_with_backoff(func, *args, **kwargs):
    max_retries = 3
    base_delay = 2
    for attempt in range(max_retries):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            err_str = str(e).lower()
            if "429" in err_str or "quota" in err_str or "503" in err_str:
                if attempt == max_retries - 1:
                    raise e
                time.sleep(base_delay * (2 ** attempt))
            else:
                raise e

# 1. Configure Gemini & Disable Dangerous Content Block for Infosec terms
genai.configure(api_key=api_key)

safety_settings = {
    HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
    HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_NONE,
    HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_NONE,
    HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_NONE,
}

# 2. ChromaDB Setup with Custom Gemini Embedding Function
class GeminiEmbeddingFunction(chromadb.EmbeddingFunction):
    def __call__(self, input: list[str]) -> list[list[float]]:
        # Sometimes list comes in directly
        result = genai.embed_content(
            model="models/gemini-embedding-001",
            content=input,
            task_type="retrieval_document"
        )
        if "embedding" in result:
            embeds = result['embedding']
            if isinstance(embeds[0], list):
                return embeds
            else:
                return [embeds]
        return []

# Initialize Vector DB
chroma_client = chromadb.PersistentClient(path="./chroma_db")
gemini_ef = GeminiEmbeddingFunction()
# create or get the vector index
collection = chroma_client.get_or_create_collection(name="cybersec_kb", embedding_function=gemini_ef)

def ingest_sample_document():
    # Only ingest if collection is empty to prevent duplication
    if collection.count() == 0:
        sample_doc = """
        Authentication: All corporate identities must enforce Multi-Factor Authentication (MFA). A strong password minimum length is 12 characters. Passwords must rotate every 90 days.
        Data Protection: All customer information must reside in AES-256 encrypted databases at rest. In transit, data must be secured via TLS 1.3.
        Endpoint Analytics: Endpoints must utilize EDR tooling. Regular scans for zero-day malware and network exploits are mandatory.
        Incident Response: Penetration testing is conducted bi-annually. A dedicated response team (CSIRT) must be active 24/7 to counter security breaches.
        Ransomware Defense: Segregated, offline immutable backups must be maintained and tested globally.
        Access Control: Apply the Principle of Least Privilege across all IAM policies.
        """
        # Minimal chunking strategy
        chunks = [chunk.strip() for chunk in sample_doc.split("\n") if chunk.strip() and "NIST" not in chunk]
        ids = [f"doc_chunk_{i}" for i in range(len(chunks))]
        
        try:
            collection.add(documents=chunks, ids=ids)
            print("[RAG] Ingested internal cybersecurity knowledge base successfully.")
        except Exception as e:
             print(f"[RAG Error] {e}")

def generate_chat_response(query: str, history=None) -> str:
    # 1. Query the vector DB for context
    try:
        results = collection.query(query_texts=[query], n_results=3)
        retrieved_docs = results['documents'][0] if results['documents'] else []
        context = "\n".join(retrieved_docs)
    except Exception as e:
        context = ""
        print(f"RAG Retrieval failed: {e}")

    # 2. Prepare the prompt integrating the context safely
    system_instruction = f"""
    You are an elite Cybersecurity Architect consulting for Small & Medium Enterprises.
    Use ONLY the context below to answer. If the context does not contain the answer, reply "I am restricted to answering from the verified corporate knowledge base, and I don't have that information."
    Be authoritative, concise, and professional.
    
    [RETRIEVED CONTEXT START]
    {context}
    [RETRIEVED CONTEXT END]
    """
    
    model = genai.GenerativeModel(
        model_name="gemini-2.5-flash",
        system_instruction=system_instruction,
        safety_settings=safety_settings
    )
    
    # Format History
    structured_history = []
    if history:
        for msg in history:
            role = "user" if msg["role"] == "user" else "model"
            structured_history.append({"role": role, "parts": [msg["text"]]})

    try:
        chat = model.start_chat(history=structured_history)
        response = chat.send_message(query)
        return response.text
    except Exception as e:
        err_str = str(e)
        if "429" in err_str or "quota" in err_str.lower():
            raise Exception("Ratelimit Warning: The AI is currently overloaded. Please wait 30 seconds.")
        raise e

def generate_chat_response_stream(query: str, history=None):
    # 1. Query the vector DB for context
    try:
        results = collection.query(query_texts=[query], n_results=3)
        retrieved_docs = results['documents'][0] if results['documents'] else []
        context = "\n".join(retrieved_docs)
    except Exception as e:
        context = ""
    
    system_instruction = f"""
    You are an elite, helpful Cybersecurity Expert. You will receive <DATABASE_CONTEXT> about the user. Use this context if it is relevant to their question. However, if the answer is not in the context, you MUST gracefully fall back to your general cybersecurity knowledge to provide a helpful, actionable answer. NEVER refuse to answer by saying you are restricted.
    
    <DATABASE_CONTEXT>
    {context}
    </DATABASE_CONTEXT>
    """
    
    # Format History
    structured_history = []
    if history:
        for msg in history:
            role = "user" if msg["role"] == "user" else "model"
            structured_history.append({"role": role, "parts": [msg["text"]]})

    max_retries = 3
    base_delay = 2
    current_model = "gemini-2.5-flash"
    
    for attempt in range(max_retries):
        model = genai.GenerativeModel(
            model_name=current_model,
            system_instruction=system_instruction,
            safety_settings=safety_settings
        )
        try:
            chat = model.start_chat(history=structured_history)
            response = chat.send_message(query, stream=True)
            for chunk in response:
                if chunk.text:
                    yield chunk.text
            return
        except Exception as e:
            err_str = str(e).lower()
            if "429" in err_str or "quota" in err_str or "503" in err_str or "exhausted" in err_str:
                if attempt == max_retries - 1 or "perday" in err_str:
                    logging.error(f"Chatbot failed after limits reached: {e}", exc_info=True)
                    yield "⚠️ AI is heavily overloaded right now due to Google free-tier quota limits (20/day config). Please chat later."
                    return
                
                delay = base_delay * (2 ** attempt)
                match = re.search(r'retry in (\d+(?:\.\d+)?)s', err_str)
                if match:
                    delay = max(delay, float(match.group(1)) + 1.0)
                
                yield f"<br>*(API Rate Limit detected. Retrying in {int(delay)} seconds...)*<br>"
                time.sleep(delay)
            else:
                logging.error(f"Chatbot failed: {e}", exc_info=True)
                yield "An internal error occurred."
                return

async def generate_recommendations(industry: str, answers: list, domain_scores: dict) -> dict:
    prompt = f"""
    You are an elite Cybersecurity Expert.
    The client operates in the {industry} industry.
    They have taking a security baseline test.
    Here are their calculated domain risk severity scores (out of 100, where 100 is critical risk): {domain_scores}
    Here are their raw answers (including the text they selected): {answers}
    
    Task: Return a STRICT JSON mapping where each key is a domain name (from the domain scores) and the value is a single string containing a highly specific, tailored recommendation (max 2 sentences) to improve their score. Do not wrap in Markdown formatting like ```json. Return ONLY raw valid JSON text.
    """
    try:
        response = await retry_with_backoff_async(
            prompt=prompt,
            safety_settings=safety_settings,
            generation_config={"response_mime_type": "application/json"}
        )
        import json
        text = response.text.strip()
        # Aggressive Regex cleanup in case model ignores mime_type
        text = re.sub(r'^```(?:json)?\s*', '', text)
        text = re.sub(r'\s*```$', '', text)
        return json.loads(text.strip())
    except Exception as e:
        logging.error(f"Recommendation generation failed: {e}", exc_info=True)
        if "API_QUOTA_EXHAUSTED" in str(e):
            return {dom: "⚠️ Google Gemini Free-Tier limit reached (20 requests/day). The AI requires a paid upgrade or 24-hours to reset." for dom in domain_scores.keys()}
            
        # Fallback
        return {dom: "Consult with a security engineer to improve this domain." for dom in domain_scores.keys()}

async def generate_action_plan(industry: str, overall_score: float, recommendations: dict) -> str:
    prompt = f"""
You are an elite, pragmatic Executive Cybersecurity Advisor reporting directly to a C-Level executive in the {industry} sector.

STRICT CONSTRAINTS:

Tone & Language: Use simple, non-technical business language. Zero complex IT jargon. Do not use conversational filler, greetings, or letter formatting (No "Dear...", No "Based on...").

Synthesis: You are provided with the previously generated category recommendations: {recommendations}. DO NOT generate new random advice. Synthesize and prioritize THESE existing points into a cohesive overall plan.

Keep output extremely concise to prevent token limits.

REQUIRED OUTPUT FORMAT (Markdown):

Executive Summary
2-sentence maximum summary of their overall security posture based on their score ({overall_score}) and industry. State the primary business risk clearly.

Immediate Action Plan
Consolidate the most critical issues from the provided category recommendations into 3 to 5 immediate, highly actionable steps.

Format as a bulleted list. Start each with a strong action verb (e.g., "Implement", "Require"). Focus on what the C-level must tell their IT team to do TODAY.

6-Month Roadmap
Provide a brief, step-by-step roadmap for the next 6 months. Group by month ranges (e.g., Month 1-2, Month 3-4). Max 1 short sentence per phase.
"""
    try:
        res = await retry_with_backoff_async(prompt=prompt, safety_settings=safety_settings)
        return res.text
    except Exception as e:
        logging.error(f"Action plan generation failed: {e}", exc_info=True)
        if "API_QUOTA_EXHAUSTED" in str(e):
            return "### ⚠️ Google Gemini Free-Tier Exhausted\nYour API Key has hit the strict 20 request/day limit for `gemini-2.5-flash`. Please wait 24 hours or upgrade your billing to unlock further AI synthesis."
            
        return "The AI Action Plan generator encountered an internal error. Please review the backend logs."
