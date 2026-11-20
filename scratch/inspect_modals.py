import re, os
base_dir = r"C:\Users\DELL\.gemini\antigravity\scratch\kiotviet-pos-app"
with open(os.path.join(base_dir, "frontend", "index.html"), "r", encoding="utf-8") as f:
    html = f.read()

modals = re.findall(r'id=["\']([a-zA-Z0-9_\-]+-modal)["\']', html)
print("Modals found:", modals)
