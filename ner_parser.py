# ner_parser.py
import sys
import spacy
import json
import re
import langdetect

print("PYTHON PATH:", sys.executable, file=sys.stderr)

text = sys.stdin.read()

# Dil tespiti ve uygun spaCy modeli yükleme
try:
    detected_lang = langdetect.detect(text)
except Exception:
    detected_lang = 'en'

if detected_lang == 'tr':
    try:
        nlp = spacy.load("tr_core_news_sm")
    except OSError:
        print(json.dumps({"error": "Türkçe spaCy modeli (tr_core_news_sm) yüklü değil. Yüklemek için: python3 -m spacy download tr_core_news_sm"}))
        sys.exit(1)
else:
    nlp = spacy.load("en_core_web_sm")

text = sys.stdin.read()
doc = nlp(text)

result = {
    "name": None,
    "title": None,
    "company": None,
    "email": None,
    "tel": None,
    "address": None,
    "web": None
}

lines = text.split("\n")
address_keywords = ["mah.", "bulvar", "cadde", "sokak", "no:", "/", "plaza", "blok", "kat", "daire", "apart", "site", "bina", "ilçe", "şehir", "posta"]

def fix_company_ocr_errors(text):
    replacements = [
        # Türkçe varyasyonlar
        (r"a\.5\.|a\.s\.|a\.ş|a\.s|aş|as", "A.Ş."),
        (r"ltd\. sti|ltd\. şti|ltd şti|ltd sti|ltd\. şti\.|ltd şti\.", "LTD. ŞTİ."),
        (r"san\. tic|san tic|san\. ve tic|san ve tic", "SAN. ve TİC."),
        (r"anonim şirketi|anonim sirketi", "A.Ş."),
        (r"limited şirketi|limited sirketi", "LTD. ŞTİ."),
        # İngilizce varyasyonlar
        (r"inc\.|inc|lnc", "Inc."),
        (r"corp\.|corp", "Corp."),
        (r"llc\.|llc", "LLC"),
        (r"ltd\.|ltd", "Ltd."),
        (r"co\.|co", "Co."),
    ]
    fixed = text
    for pattern, repl in replacements:
        fixed = re.sub(pattern, repl, fixed, flags=re.IGNORECASE)
    return fixed

def is_name_candidate(line, title_keywords, company_keywords):
    # Rakam, @, www, .com, unvan veya şirket anahtar kelimesi içeriyorsa geçersiz
    l = line.lower()
    if any(x in l for x in ["@", "www", ".com", ".net", ".org", "http"]):
        return False
    if any(kw in l for kw in title_keywords):
        return False
    if any(kw in l for kw in company_keywords):
        return False
    if any(char.isdigit() for char in line):
        return False
    # 2 veya 3 kelime olmalı
    words = line.strip().split()
    if not (1 < len(words) < 4):
        return False
    # Her kelime büyük harfle başlamalı
    if not all(w and w[0].isupper() for w in words):
        return False
    # Sadece harflerden oluşmalı
    if not all(w.isalpha() for w in words):
        return False
    return True

COMPANY_KEYWORDS = ["a.ş.", "ltd.", "şti.", "san.", "tic.", "inc.", "corp.", "llc", "co."]

# Unvan (title) anahtar kelimeleri
TITLE_KEYWORDS = [
    "müdür", "uzman", "yönetici", "direktör", "başkan", "sorumlu", "koordinatör", "asistan", "danışman", "şef", "saha mühendisi", "mühendis", "doktor", "prof.", "avukat", "öğretmen", "öğrenci", "stajyer",
    "specialist", "expert", "manager", "director", "chief", "officer", "consultant", "engineer", "assistant", "intern", "lead", "head", "supervisor", "representative", "analyst", "developer", "designer", "architect"
]

# Title tespiti
for line in lines:
    l = line.lower()
    if any(kw in l for kw in TITLE_KEYWORDS):
        result["title"] = line.strip()
        break

email_match = re.search(r"[\w\.-]+@[\w\.-]+", text)
if email_match:
    result["email"] = email_match.group(0)

tel_matches = re.findall(r"(\+?\d{1,3}[\s-]?)?(\(?\d{3}\)?[\s-]?)?\d{2,4}[\s-]?\d{2,4}[\s-]?\d{2,4}", text)
phones = []
for match in tel_matches:
    phone = ''.join(match)
    phone = re.sub(r"[^\d+]", "", phone)  
    if 7 < len(phone) < 16:
        phones.append(phone)
if phones:
    result["tel"] = max(phones, key=len)

if not result["tel"]:
    for line in lines:
        digits = re.sub(r"\D", "", line)
        if len(digits) >= 7 and not ("www" in line or "@" in line):
            tel_candidate = re.sub(r"[^\d\+\-\(\)\s]", "", line).strip()
            result["tel"] = tel_candidate
            break

address = None
for i, line in enumerate(lines):
    l = line.lower()
    if any(kw in l for kw in address_keywords):
        address_lines = [line.strip()]
        for j in range(i+1, len(lines)):
            next_line = lines[j].strip()
            if next_line and not ("www" in next_line or "@" in next_line):
                address_lines.append(next_line)
            else:
                break
        address = " ".join(address_lines)
        break
if not address:
    for line in lines:
        if re.match(r"^\d", line.strip()) and not ("www" in line or "@" in line):
            address = line.strip()
            break
if address:
    result["address"] = address

# Web sitesi tespiti
web_match = None
for line in lines:
    l = line.lower()
    if ("www." in l or "http" in l or ".com" in l or ".net" in l or ".org" in l or "web" in l) and not ("@" in l):
        web_match = line.strip()
        break
if web_match:
    result["web"] = web_match

# Eğer spaCy ile isim bulunamazsa, satır satır kontrol et
if not result["name"]:
    for line in lines:
        if is_name_candidate(line, TITLE_KEYWORDS, COMPANY_KEYWORDS):
            result["name"] = line.strip()
            break

print(json.dumps(result))