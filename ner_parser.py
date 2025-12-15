# ner_parser.py
import sys
import json
import re
import os
from openai import OpenAI

print("PYTHON PATH:", sys.executable, file=sys.stderr)

text = sys.stdin.read()

# OpenAI API key'ini environment variable'dan al
API_KEY = os.getenv("OPENAI_API_KEY")
if not API_KEY:
    print(json.dumps({"error": "OPENAI_API_KEY environment variable is required"}))
    sys.exit(1)

client = OpenAI(api_key=API_KEY)

# OpenAI API ile bilgi çıkarma
try:
    prompt = f"""
    Aşağıda bir kartvizitten OCR ile çıkarılmış ham yazı var.
    Bu bilgiyi incele ve sadece JSON formatında cevap ver.
    Alanlar: name, title, email, tel, company, address, web, description.
    Alanlardan biri yoksa boş string ("") koy.
    Company alanı boşsa, OCR'daki e-posta domain'inden veya web adresinden şirket adını tahmin et.

    OCR TEXT:
    {text}
    """

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "Sen bir OCR sonrası kartvizit düzenleyicisin. Sadece JSON formatında cevap ver."},
            {"role": "user", "content": prompt}
        ],
        temperature=0
    )

    structured = response.choices[0].message.content
    print(structured)

except Exception as e:
    # Hata durumunda basit regex tabanlı çıkarma yap
    result = {
        "name": None,
        "title": None,
        "company": None,
        "email": None,
        "tel": None,
        "address": None,
        "web": None,
        "description": ""
    }
    
    # Email tespiti
    email_match = re.search(r"[\w\.-]+@[\w\.-]+", text)
    if email_match:
        result["email"] = email_match.group(0)
    
    # Telefon tespiti
    tel_matches = re.findall(r"(\+?\d{1,3}[\s-]?)?(\(?\d{3}\)?[\s-]?)?\d{2,4}[\s-]?\d{2,4}[\s-]?\d{2,4}", text)
    phones = []
    for match in tel_matches:
        phone = ''.join(match)
        phone = re.sub(r"[^\d+]", "", phone)  
        if 7 < len(phone) < 16:
            phones.append(phone)
    if phones:
        result["tel"] = max(phones, key=len)
    
    # Web sitesi tespiti
    web_match = re.search(r"(www\.|https?:\/\/)[^\s]+", text)
    if web_match:
        result["web"] = web_match.group(0)
    
    print(json.dumps(result))