import re, os

base_dir = r"C:\Users\DELL\.gemini\antigravity\scratch\kiotviet-pos-app"
with open(os.path.join(base_dir, "frontend", "index.html"), "r", encoding="utf-8") as f:
    html = f.read()

views = re.findall(r'id=["\']view-([^"\']+)["\']', html)
print("Views in index.html:", views)

menu_items = re.findall(r'data-view=["\']([^"\']+)["\']', html)
print("Menu items:", menu_items)
