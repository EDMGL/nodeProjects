from fastapi import FastAPI, UploadFile, File
from pydantic import BaseModel
import pytesseract
from PIL import Image
import base64, io
from openai import OpenAI

# OpenAI API key ortam değişkeninden gelsin (güvenli kullanım)
import os

API_KEY = os.getenv("OPENAI_API_KEY")
if not API_KEY:
    raise ValueError("OPENAI_API_KEY environment variable is required")

app = FastAPI()

client = OpenAI(api_key=API_KEY)

@app.post("/upload-ocr")
async def upload_ocr(file: UploadFile = File(...)):
    try:
        # Dosya oku
        contents = await file.read()
        image = Image.open(io.BytesIO(contents))

        # OCR
        raw_text = pytesseract.image_to_string(image, lang="eng+tur")

        # GPT için prompt
        prompt = f"""
        Aşağıda bir kartvizitten OCR ile çıkarılmış ham yazı var.
        Bu bilgiyi incele ve sadece JSON formatında cevap ver.
        Alanlar: name, title, email, tel, company, address, web, description.
        Alanlardan biri yoksa boş string ("") koy.
        Company alanı boşsa, OCR’daki e-posta domain’inden veya web adresinden şirket adını tahmin et.

        OCR TEXT:
        {raw_text}
        """

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "Sen bir OCR sonrası kartvizit düzenleyicisin."},
                {"role": "user", "content": prompt}
            ],
            temperature=0
        )

        structured = response.choices[0].message.content
        print(structured)

        return {
            "status": "success",
            "fileName": file.filename,
            "ocrText": raw_text,
            "structured": structured
        }

    except Exception as e:
        return {"status": "error", "message": str(e)}