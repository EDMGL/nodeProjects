import os
import base64
import json
import io
from fastapi import FastAPI, UploadFile, File
from openai import OpenAI
from PIL import Image  # Pillow kütüphanesini ekledik
from dotenv import load_dotenv

# ---------------- AYARLAR ----------------
# .env dosyasını yükle
load_dotenv()
API_KEY = os.getenv("OPENAI_API_KEY")
# -----------------------------------------

app = FastAPI()
client = OpenAI(api_key=API_KEY)

@app.post("/analyze-card")
async def analyze_card(file: UploadFile = File(...)):
    try:
        # 1. Dosya içeriğini raw bytes olarak oku
        contents = await file.read()

        # --- GÖRÜNTÜ İŞLEME VE STANDARTLAŞTIRMA (YENİ KISIM) ---
        try:
            # Gelen baytları bir görüntü olarak açmayı dene (PNG, JPG fark etmez)
            image = Image.open(io.BytesIO(contents))
            
            # Mobil cihazlar için EXIF döndürme bilgisini düzelt (opsiyonel ama iyidir)
            try:
                from PIL import ImageOps
                image = ImageOps.exif_transpose(image)
            except:
                pass # Hata verirse devam et, kritik değil

            # Eğer görüntü RGBA (saydam PNG) ise RGB'ye çevir (JPEG saydamlık desteklemez)
            if image.mode in ("RGBA", "P"):
                 image = image.convert("RGB")

            # Görüntüyü bellekte (RAM'de) JPEG formatına dönüştür
            output_buffer = io.BytesIO()
            # quality=85 mobil fotoğraflar için iyi bir dengedir, boyutu düşürür, kaliteyi korur.
            image.save(output_buffer, format="JPEG", quality=85)
            jpeg_data = output_buffer.getvalue()

            print(f"Görüntü başarıyla JPEG formatına dönüştürüldü: {file.filename}")

        except Exception as img_err:
            return {"status": "error", "message": f"Dosya bir resim dosyası değil veya bozuk: {str(img_err)}"}
        
        # -------------------------------------------------------

        # 2. Dönüştürülmüş JPEG verisini Base64'e çevir
        base64_image = base64.b64encode(jpeg_data).decode('utf-8')
        # Artık formatın kesinlikle JPEG olduğundan eminiz
        mime_type = "image/jpeg" 

        print("OpenAI'a gönderiliyor...")

        # 3. OpenAI GPT-4o mini'ye Özel Promptla Gönder
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system", 
                    "content": "Sen Salesforce için veri yapılandıran uzman bir asistansın."
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text", 
                            "text": """
                            Bu kartvizitteki bilgileri oku ve aşağıdaki JSON formatına kesinlikle uy.
                            
                            İstenen JSON Sıralaması ve Formatı:
                            {
                                "name": "...",
                                "title": "...",
                                "tel": "...",
                                "company": "...",
                                "email": "...",
                                "address": "...",
                                "web": "...",
                                "description": "..."
                            }
                            
                            Eğer bilgi yoksa 'null' yaz. Sadece JSON döndür, markdown kullanma.
                            """
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime_type};base64,{base64_image}"
                            },
                        },
                    ],
                }
            ],
            temperature=0.0,
        )
        
        # 4. Cevabı Temizle ve Döndür
        raw_content = response.choices[0].message.content
        cleaned_content = raw_content.replace("```json", "").replace("```", "").strip()
        
        json_data = json.loads(cleaned_content)

        return {
            "status": "success",
            "fileName": file.filename,
            "data": json_data
        }

    except json.JSONDecodeError:
        return {
            "status": "error", 
            "message": "AI JSON formatında cevap veremedi.",
            "raw_response": raw_content
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}