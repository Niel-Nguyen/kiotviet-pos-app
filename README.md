# KiotPro - Web App Quản Lý Bán Hàng & Phân Phối Chuẩn Nghiệp Vụ

Hệ thống quản lý bán hàng (POS), phân phối, kho hàng, dòng tiền và giá riêng theo khách hàng — được tối ưu hóa theo chuẩn kế toán bán lẻ và nhà phân phối.

---

## 🌟 Các Cải Tiến Lớn Vừa Được Nâng Cấp (Major Enhancements)

### 1. Chuẩn Hóa Kế Toán & Độ Chính Xác Sổ Quỹ (Accounting Precision)
- **Chuẩn hóa tiền thừa và két tiền**: Khi khách đưa số tiền lớn hơn hóa đơn (ví dụ đơn 180.000 đ, khách đưa 200.000 đ), hệ thống tính tiền thối lại là 20.000 đ và **chỉ ghi nhận đúng 180.000 đ thực thu vào sổ quỹ két tiền**, không làm đội khống số dư quỹ như trước.
- **Tính giá vốn bình quân gia quyền di động (Weighted Moving Average Cost - MAC)**:
  $$\text{Giá vốn mới} = \frac{(\text{Tồn cũ} \times \text{Giá vốn cũ}) + (\text{Số lượng nhập} \times \text{Giá nhập})}{\text{Tồn cũ} + \text{Số lượng nhập}}$$
  Đảm bảo giá trị hàng tồn và lợi nhuận gộp luôn phản ánh trung thực chi phí kho khi nhập hàng nhiều đợt ở các mức giá khác nhau.
- **Tách bạch Doanh thu thuần, Thuế VAT và Lợi nhuận gộp**:
  - Giao diện POS có tùy chọn thuế VAT (0%, 8%, 10%).
  - Lợi nhuận gộp = $\text{Doanh thu thuần (sau chiết khấu, trước VAT)} - \text{Giá vốn (MAC)}$.
  - Thuế VAT là nghĩa vụ phải nộp, hoàn toàn không bị tính gộp làm sai lệch lợi nhuận của cửa hàng.

### 2. Kiểm Soát Nhập Liệu & Chặn Bán Âm Kho (Data Integrity)
- **Chặn bán âm kho**: Có tùy chọn trong Cài đặt `Cho phép/Không cho phép bán khi hết tồn kho`. Mặc định hệ thống chặn và báo lỗi rõ ràng nếu thủ kho hoặc thu ngân xuất bán vượt quá tồn kho thực tế.
- **Chặn thanh toán nợ vượt dư nợ**: Không cho phép thu nợ khách hoặc trả nợ NCC vượt quá số dư nợ hiện tại, ngăn ngừa sai lệch công nợ.
- **Chặn số lượng âm, đơn giá âm**.

### 3. Sẵn Sàng Đa Người Dùng & Mạng Nội Bộ (LAN Multi-client)
- Chuyển đổi server sang **`socketserver.ThreadingTCPServer`** (đa luồng), cho phép nhiều máy tính, máy tính bảng hoặc điện thoại của thu ngân truy cập cùng một lúc mà không bị nghẽn (block).
- Bind vào `0.0.0.0` và tự động phát hiện địa chỉ IP nội bộ (LAN IP) để nhân viên trong cùng mạng Wi-Fi có thể kết nối ngay qua điện thoại/tablet: `http://<IP-máy-chủ>:8080`.
- **Sao lưu dữ liệu 1-click**: Tải file `.db` trực tiếp từ giao diện cài đặt về máy tính.

### 4. Mở Rộng Nghiệp Vụ Phân Phối
- **Quy đổi đơn vị đóng gói (Sub-units)**: Hỗ trợ thiết lập đơn vị phụ kèm hệ số quy đổi (Ví dụ: 1 Thùng = 24 Lon, 1 Túi = 5 Kg).
- **Khách đổi trả hàng (Sales Returns)**: Lập phiếu trả hàng, tự động nhập lại kho hàng, hoàn tiền mặt ra khỏi quỹ hoặc cấn trừ trực tiếp vào công nợ cũ của khách.
- **Lọc báo cáo theo kỳ**: Hôm nay, Hôm qua, 7 ngày qua, Tháng này.
- **Hóa đơn in nhiệt 80mm động**: Tự động tải tên cửa hàng, hotline, địa chỉ và lời chào từ cấu hình hệ thống.

---

## 🚀 Hướng Dẫn Khởi Chạy

Dự án chạy hoàn toàn trên nền tảng **Python 3.11 chuẩn** (không cần cài thêm pip packages, không cần npm).

### Cách 1: Click file Start (Khuyên dùng)
- Click đúp vào file `start.bat` trong thư mục dự án.

### Cách 2: Dòng lệnh PowerShell
```powershell
& "C:\Users\DELL\AppData\Local\Programs\Python\Python311\python.exe" "C:\Users\DELL\.gemini\antigravity\scratch\kiotviet-pos-app\backend\server.py"
```

Khi server khởi chạy, màn hình sẽ hiển thị:
- **Địa chỉ truy cập cục bộ**: `http://localhost:8080`
- **Địa chỉ truy cập qua mạng LAN/Wi-Fi**: `http://<IP-máy-chủ>:8080` (để dùng cho máy tính bảng, điện thoại hoặc máy tính quầy khác)

---

## 📁 Cấu Trúc Mã Nguồn

```text
kiotviet-pos-app/
├── backend/
│   ├── database.py       # Khởi tạo SQLite DB, quản lý schema, seed dữ liệu mẫu
│   └── server.py         # Multi-threaded HTTP Server, REST API endpoints, MAC cost
├── frontend/
│   ├── css/
│   │   └── style.css     # Theme KiotViet hiện đại, thẻ cảnh báo, hóa đơn in nhiệt
│   ├── js/
│   │   ├── api.js        # Service kết nối API RESTful
│   │   ├── pos.js        # Logic bán hàng, giỏ hàng, bảng giá riêng, thuế VAT, tiền thừa
│   │   └── app.js        # Điều hướng SPA, sổ quỹ, thẻ kho, khách trả hàng, cài đặt
│   └── index.html        # Giao diện chính SPA
├── data/
│   └── kiotviet.db       # Cơ sở dữ liệu SQLite
├── start.bat             # File khởi động nhanh cho Windows
├── start.ps1             # Script khởi động PowerShell
└── README.md             # Tài liệu chi tiết
```
