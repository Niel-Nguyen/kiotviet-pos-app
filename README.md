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

### 5. Nâng Cấp Giao Diện Enterprise SaaS Chuyên Nghiệp (Design System)
- **Hệ thống Design Tokens CSS**: Bộ biến màu sắc chuẩn quản trị doanh nghiệp (Navy `#1e3a8a`, Slate `#0f172a`, Neutral Surface `#f8fafc`), typography có thứ bậc rõ ràng, bán kính bo góc và độ đổ bóng nhẹ nhàng tinh tế.
- **Loại bỏ Emoji & Tích hợp Vector SVG thuần**: Toàn bộ icon thanh điều hướng, nút bấm, cảnh báo và giỏ hàng được thay thế bằng SVG chuyên nghiệp, sắc nét trên màn hình Retina/High-DPI.
- **Trải nghiệm POS tốc độ cao**: Tìm kiếm / quét mã vạch nổi bật, phân bổ giỏ hàng - tổng tiền trực quan, hiển thị nhãn giá riêng theo khách hàng rõ ràng, nút thanh toán lớn dễ bấm.
- **Chuẩn hóa Bảng dữ liệu & Số liệu tài chính**: Toàn bộ cột tiền tệ được căn phải (`.text-right`) và định dạng font số tabular (`tabular-nums`) giúp mắt dễ dàng so sánh các hàng.
- **Responsive toàn diện cho Desktop, Tablet & Mobile**: Thanh bên (sidebar) tự động thu gọn thành drawer trượt kèm lớp phủ backdrop trên màn hình nhỏ; bảng dữ liệu có vùng cuộn ngang kiểm soát mượt mà, không bao giờ làm vỡ layout.

### 6. Phân Quyền Người Dùng (RBAC) & Quản Lý Tài Khoản Bảo Mật
- **Nguyên tắc Mặc định Từ chối (Deny by default)**: Kiểm tra quyền hạn nghiêm ngặt ở **tất cả API backend** (GET, POST, PUT, DELETE, Backup download). Trả về HTTP 401 khi chưa đăng nhập, HTTP 403 khi không đủ quyền hạn.
- **Hệ thống 6 Vai trò Doanh nghiệp**:
  1. **Quản trị viên (`admin`)**: Toàn quyền cấu hình hệ thống, quản lý tài khoản nhân viên, phân quyền, xem nhật ký kiểm toán và tải bản sao lưu dữ liệu.
  2. **Quản lý (`manager`)**: Xem báo cáo tài chính, toàn quyền nghiệp vụ bán hàng, nhập hàng, kiểm kho, đổi trả, đối tác và công nợ; không có quyền quản lý người dùng hoặc cấu hình bảo mật.
  3. **Thu ngân (`cashier`)**: Bán hàng tại quầy POS, in hóa đơn, lập phiếu trả hàng; **bị ẩn hoàn toàn giá vốn (`cost_price`)**, không được kiểm kho, không được nhập hàng, không được vào sổ quỹ.
  4. **Kho (`warehouse`)**: Lập phiếu nhập hàng, kiểm kho / cân bằng tồn, quản lý danh mục hàng hóa; không có quyền vào sổ quỹ hay xem báo cáo tài chính.
  5. **Kế toán (`accountant`)**: Quản lý sổ quỹ thu/chi, thanh toán công nợ khách hàng và nhà cung cấp, xem báo cáo doanh thu; không được sửa danh mục hàng hóa hay chỉnh kho.
  6. **Chỉ xem (`viewer`)**: Xem thông tin danh mục, đơn hàng được phép; không thể thêm, sửa, xóa hoặc thực hiện bất kỳ giao dịch tài chính nào.
- **Quy trình Khởi tạo An toàn (Safe Bootstrap)**:
  - Tuyệt đối **không dùng mật khẩu mặc định hoặc tài khoản hard-code** trong mã nguồn.
  - Khi hệ thống chưa có người dùng nào (`users COUNT = 0`), ứng dụng mở màn hình thiết lập tài khoản Quản trị viên đầu tiên.
  - Ngay sau khi Quản trị viên được tạo, endpoint bootstrap **đóng vĩnh viễn (khóa chặn hoàn toàn)** để tránh xâm phạm.
- **Mã Hóa Mật Khẩu Chuẩn Công Nghiệp (PBKDF2-HMAC-SHA256)**:
  - Sử dụng thư viện chuẩn của Python: `hashlib.pbkdf2_hmac` với thuật toán SHA-256, **100.000 vòng lặp** và **salt ngẫu nhiên 16 bytes** (`secrets.token_hex(16)`).
  - So sánh mật khẩu bằng `hmac.compare_digest` chống tấn công timing attack.
- **Quản Lý Phiên & Thu Hồi Tức Thì**:
  - Phiên làm việc có thời hạn lưu trữ trong bảng `sessions`, cookie bảo mật với các cờ `HttpOnly; SameSite=Lax`.
  - Hỗ trợ cả token header `Authorization: Bearer <token>`.
  - **Khóa tài khoản thu hồi phiên ngay lập tức**: Khi quản trị viên khóa tài khoản, toàn bộ phiên đăng nhập đang hoạt động của người đó bị xóa sạch khỏi cơ sở dữ liệu, chặn đứng truy cập ngay tại request tiếp theo.
  - Không bao giờ ghi mật khẩu, token hay cookie vào nhật ký kiểm toán.

### 7. Truy Vết Kiểm Toán Nghiệp Vụ (Audit Trail & Timeline)
- **Ghi nhận đồng thời trong cùng Transaction SQLite**: Mọi sự kiện kiểm toán (`audit_logs`) được ghi cùng một transaction với nghiệp vụ (Bán hàng, Nhập kho, Trả hàng, Cân bằng kho, Thu/Chi quỹ, Quản lý tài khoản). Nếu việc ghi audit thất bại, toàn bộ giao dịch nghiệp vụ sẽ **rollback 100%**, đảm bảo tính toàn vẹn tuyệt đối.
- **Bất biến (Immutable Audit Trail)**: API backend chặn đứng mọi yêu cầu sửa (`PUT`) hoặc xóa (`DELETE`) nhật ký kiểm toán với mã lỗi HTTP 403 `AUDIT_IMMUTABLE`.
- **Dòng thời gian (Timeline) theo Chứng từ**:
  - Xem chuỗi sự kiện tuần tự của bất kỳ hóa đơn, phiếu nhập hay phiếu trả nào: ai tạo, thời điểm nào, chi tiết mặt hàng, số tiền, phương thức thanh toán, tiền thừa, công nợ, và liên kết trả hàng phát sinh sau đó.
  - Dữ liệu lịch sử trước khi bật audit được đánh dấu minh bạch là `'Hệ thống / Dữ liệu cũ'`, không tự gán danh tính giả mạo.

---

## 🛡️ Nâng Cấp Bảo Mật & Toàn Vẹn Giao Dịch (v1.1 Professional Hardening)

Các cải tiến vừa được áp dụng để đưa app lên chuẩn chuyên nghiệp đa quầy:

1. **Chống bán dưới giá vốn**: Server tự tra giá tham chiếu (giá riêng khách → giá theo đơn vị → giá cơ bản). Thu ngân vẫn được thỏa thuận giá tại quầy, nhưng hệ thống chặn mọi đơn giá thấp hơn giá vốn (`PRICE_BELOW_COST`) và giá âm.
2. **Chống race condition đa luồng**: mọi handler ghi dùng `BEGIN IMMEDIATE` + SQLite WAL mode; trừ tồn kho bằng UPDATE tương đối có điều kiện `stock >= ?` (`INSUFFICIENT_STOCK`) — nhiều quầy bán cùng lúc không bao giờ âm kho.
3. **Mã chứng từ không bao giờ trùng/tái sử dụng**: sinh mã từ `sqlite_sequence` (AUTOINCREMENT), an toàn kể cả sau khi xóa dòng cũ.
4. **CORS whitelist**: chỉ echo Origin nằm trong biến môi trường `KIOTPRO_ALLOWED_ORIGINS` (phân tách bằng dấu phẩy) cùng `localhost/127.0.0.1`. Tuyệt đối không phản chiếu Origin tùy ý kèm credentials.
5. **Giá vốn bị ẩn hoàn toàn với vai trò thiếu quyền**: `GET /api/orders` và chi tiết hóa đơn tự loại bỏ `total_cost`, `profit`, `cost_price` nếu vai trò không có `products:view_cost`.
6. **Xóa an toàn có kiểm soát**: chặn xóa khách còn công nợ (`CUSTOMER_HAS_DEBT`), khách/sản phẩm/NCC đã phát sinh giao dịch (`*_IN_USE`) với thông báo rõ ràng thay vì lỗi hệ thống 500.
7. **Lợi nhuận chuẩn kế toán sau trả hàng**: profit chỉ trừ **biên lợi nhuận** của hàng trả (giá trị trả − giá vốn hàng trả), không trừ cả giá vốn như trước.

### Biến môi trường mới

| Biến | Ý nghĩa |
| --- | --- |
| `KIOTPRO_ALLOWED_ORIGINS` | Danh sách Origin được phép CORS, phân tách bằng dấu phẩy (vd: `https://pos.example.com,https://admin.example.com`) |

## 🔒 Khuyến Cáo Bảo Mật Mạng (Security Notice)
> [!WARNING]
> Khi vận hành ứng dụng trong mạng nội bộ (LAN) hoặc qua mạng không tin cậy (Wi-Fi công cộng):
> - **Khuyến nghị sử dụng HTTPS hoặc VPN**: Ứng dụng chạy trên giao thức HTTP tiêu chuẩn, phù hợp cho thử nghiệm hoặc mạng LAN an toàn. Khi đưa vào môi trường sản xuất có dữ liệu thật hoặc nhiều nhân viên truy cập từ xa, hãy đặt ứng dụng sau một reverse proxy hỗ trợ HTTPS (như Nginx, Caddy, Cloudflare Tunnel) hoặc kết nối qua mạng riêng ảo (VPN).
> - **Tuyệt đối không mở port HTTP trần ra Internet công cộng** khi chưa có chứng chỉ SSL/TLS mã hóa đường truyền.

---

## 🗄️ Nâng Cấp Cơ Sở Dữ Liệu & Khôi Phục (Database Migration & Recovery)
- **Tự động sao lưu an toàn trước migration**: Trước khi áp dụng migration v2, hệ thống tự động tạo bản sao lưu nguyên vẹn tại:
  `data/kiotviet_backup_pre_v2.db`
- **Bảng theo dõi Migration (`schema_migrations`)**: Quản lý lịch sử nâng cấp schema có phiên bản:
  - Phiên bản 1 (`v1_initial_schema`): Schema cốt lõi hàng hóa, khách hàng, đơn hàng, sổ quỹ.
  - Phiên bản 2 (`v2_auth_rbac_audit`): Thêm bảng `users`, `sessions`, `audit_logs` và gắn cột `user_id`, `user_name` vào tất cả chứng từ.
- **Cách khôi phục dữ liệu**: Nếu muốn khôi phục về trạng thái trước migration, chỉ cần dừng server và copy đè file `kiotviet_backup_pre_v2.db` thành `kiotviet.db`.

---

## 🚂 Deploy bản test lên Railway

Railway phù hợp cho môi trường demo/pilot. URL Railway là URL công khai trên Internet; chỉ dùng dữ liệu demo và không dùng như môi trường production nếu chưa có kế hoạch vận hành, bảo mật và backup phù hợp.

### Cấu hình service

1. Đưa source lên một repository GitHub **private**, không đưa database, backup hoặc file `.env` lên GitHub.
2. Tạo Railway project từ repository đó. Railpack nhận diện Python qua `requirements.txt`; ứng dụng không cần cài package bên ngoài.
3. Đặt **Start Command** của service thành:
   ```sh
   python backend/server.py
   ```
4. Thêm một Railway Volume cho service, mount tại `/app/data`. App tự dùng `RAILWAY_VOLUME_MOUNT_PATH` để đặt file SQLite vào volume. Không tạo nhiều replica cho service đang dùng SQLite volume.
5. Đặt các biến môi trường sau trong Railway:
   - `KIOTPRO_COOKIE_SECURE=true`
   - `KIOTPRO_BOOTSTRAP_TOKEN=<chuỗi bí mật ngẫu nhiên dài>`
   - Railway tự cấp `PORT`; app sẽ tự đọc biến này.
6. Deploy service và kiểm tra health check ở đường dẫn `/healthz`.
7. Sau khi deploy, tạo Railway domain HTTPS. Truy cập trang lần đầu, nhập mã `KIOTPRO_BOOTSTRAP_TOKEN` cùng thông tin tài khoản Quản trị viên để khởi tạo hệ thống. Sau khi tạo admin thành công, xóa biến `KIOTPRO_BOOTSTRAP_TOKEN` và deploy lại.
8. Chỉ gửi URL cho khách test sau khi đã đăng nhập thành công, tạo tài khoản test riêng và xác nhận database tồn tại sau khi restart service.

Railway cung cấp HTTPS tự động cho Railway domain. Volume có giới hạn và chi phí tùy gói hiện hành; kiểm tra [Railway Volumes](https://docs.railway.com/volumes), [Public Networking](https://docs.railway.com/networking/public-networking) và [Start Command](https://docs.railway.com/deployments/start-command) trước khi deploy.

**Lưu ý:** Không đưa `data/kiotviet.db`, `data/test_kiotviet.db`, các file backup hoặc mật khẩu thật lên repository. Dùng một database demo riêng cho khách hàng thử nghiệm và thử khôi phục backup trước khi dùng dữ liệu thật.

---

## 🧪 Kiểm Thử Tự Động (Automated Test Suite)
Bộ kiểm thử tự động toàn diện kiểm chứng 8 tiêu chí nghiệm thu quan trọng tại `tests/test_auth_audit.py`:
1. `test_01_bootstrap_and_lockdown`: Khởi tạo admin ban đầu và khóa chặt endpoint bootstrap.
2. `test_02_unauthenticated_requests_blocked`: Chặn 401 với mọi request chưa đăng nhập.
3. `test_03_rbac_permissions_enforced`: Thu ngân bị ẩn giá vốn và chặn nhập kho/sổ quỹ; Kho bị chặn sổ quỹ/đơn bán.
4. `test_04_business_audit_trail_and_timeline`: Ghi audit đầy đủ khi bán hàng và truy vấn timeline thành công.
5. `test_05_account_lock_instant_session_revocation`: Khóa tài khoản thu hồi phiên lập tức, chặn đăng nhập mới.
6. `test_06_audit_logs_immutability`: Chặn sửa/xóa audit log qua API (403).
7. `test_07_transaction_rollback_on_audit_failure`: Rollback toàn bộ nghiệp vụ nếu audit thất bại.
8. `test_08_sales_return_linked_to_order_timeline`: Trả hàng liên kết chính xác vào timeline của hóa đơn gốc.

Chạy kiểm thử:
```powershell
& "C:\Users\DELL\AppData\Local\Programs\Python\Python311\python.exe" "C:\Users\DELL\.gemini\antigravity\scratch\kiotviet-pos-app\tests\test_auth_audit.py"
```

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
