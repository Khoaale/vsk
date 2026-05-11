import os
import json

articles_dir = "data/articles"
index_data = []

print("Đang quét các bài viết...")

# Quét tất cả các file trong thư mục
for filename in os.listdir(articles_dir):
    if filename.endswith(".json") and filename != "index.json":
        filepath = os.path.join(articles_dir, filename)
        with open(filepath, 'r', encoding='utf-8') as f:
            try:
                data = json.load(f)
                # Chỉ lấy các trường cần thiết để làm mục lục siêu nhẹ
                index_data.append({
                    "id": data.get("id"),
                    "title": data.get("title"),
                    "summary": data.get("summary"),
                    "keywords": data.get("keywords", [])
                })
            except Exception as e:
                print(f"Lỗi đọc file {filename}: {e}")

# Lưu ra file index.json
index_path = os.path.join(articles_dir, "index.json")
with open(index_path, 'w', encoding='utf-8') as f:
    json.dump(index_data, f, ensure_ascii=False, indent=2)

print(f"✅ Đã tạo thành công mục lục index.json với {len(index_data)} bài viết!")