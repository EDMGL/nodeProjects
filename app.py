import os
import json
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from openai import OpenAI
from dotenv import load_dotenv

# ---------------- AYARLAR ----------------
load_dotenv()
API_KEY = os.getenv("OPENAI_API_KEY") 
# -----------------------------------------

app = FastAPI()
client = OpenAI(api_key=API_KEY)

# Gelen veriyi karşılayacak model
class CardRequest(BaseModel):
    base64_string: str  # Frontend'den sadece bu string gelecek

@app.post("/analyze-card-base64")
async def analyze_card(request: CardRequest):
    try:
        # Gelen string'in başında "data:image..." varsa temizleyelim (Opsiyonel güvenlik)
        # Eğer frontend ham data gönderiyorsa bu satır sorun çıkarmaz.
        image_data = request.base64_string
        if "," in image_data:
            image_data = image_data.split(",")[1]

        # --- OPENAI İSTEĞİ (KATI OCR MODU) ---
        response = client.chat.completions.create(
            model="gpt-4o-mini", 
            messages=[
                {
                    "role": "system", 
                    "content": "Sen bir yapay zeka değilsin. Sen sadece görüntüdeki metni karakter karakter kopyalayan bir OCR motorusun."
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text", 
                            "text": """
                            GÖREV: Kartvizit üzerindeki yazıları oku ve JSON formatına aktar.

                            KESİN KURALLAR (İHLAL ETME):
                            1. SADECE GÖRDÜĞÜNÜ YAZ: Kartın üzerinde yazmayan hiçbir kelimeyi, şehri veya ünvanı ekleme.
                            2. TAMAMLAMA YAPMA: "Alikahya" yazıyorsa "Köyü" ekleme. Adres eksikse eksik bırak.
                            3. DÜZELTME YAPMA: Yazım hatası varsa hatayı da aynen al.
                            4. TELEFON: Numarayı kartta gördüğün formatta (boşluklu/parantezli) aynen bırak.

                            İstenen JSON:
                            {
                                "name": "...",
                                "title": "...",
                                "phone": "...", 
                                "company": "...",
                                "email": "...",
                                "address": "...", 
                                "web": "..."
                            }

                            Not: Eğer bir alan kartta yoksa 'null' değerini ver.
                            """
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                # OpenAI'a gönderirken header ekliyoruz
                                "url": f"data:image/jpeg;base64,{image_data}"
                            },
                        },
                    ],
                }
            ],
            temperature=0.0, # Yaratıcılık kapalı
        )

        # Cevabı temizle ve JSON'a çevir
        raw_content = response.choices[0].message.content
        cleaned_content = raw_content.replace("```json", "").replace("```", "").strip()
        json_data = json.loads(cleaned_content)

        return {
            "status": "success",
            "data": json_data
        }

    except json.JSONDecodeError:
        return {
            "status": "error", 
            "message": "AI cevap üretti ama JSON formatı bozuk.",
            "raw_response": raw_content
        }
    except Exception as e:
        # Loglama için burayı kullanabilirsin
        print(f"Hata: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))