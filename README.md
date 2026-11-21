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

### 8. Đơn Vị Tính & Quy Đổi Nhiều Cấp (Multi-Level Packaging Units)
- **Cấu hình đơn vị cơ sở và đơn vị đóng gói linh hoạt**: Mỗi sản phẩm có một đơn vị cơ sở (Base Unit) và có thể cấu hình không giới hạn các đơn vị bán/đóng gói lớn hơn (ví dụ: *Lon → Lốc (6 lon) → Thùng (24 lon)*).
- **Hệ số quy đổi chuẩn xác về đơn vị cơ sở**: Mô hình lưu `conversion_rate > 0` trực tiếp về đơn vị cơ sở, triệt tiêu hoàn toàn sai số làm tròn khi quy đổi lặp qua nhiều cấp.
- **Hỗ trợ số lượng thập phân**: Cho phép nhập và bán số lượng thập phân (ví dụ: 1.5 kg, 0.25 thùng) với kiểm tra đầu vào nghiêm ngặt.
- **Phân rã tồn kho trực quan (Stock Breakdown)**: Tự động phân tích tổng tồn kho thành các cấp đơn vị lớn và phần dư lẻ (ví dụ: tồn 383 lon hiển thị trực quan là `10 Thùng, 3 Lốc, 5 Lon`), không làm mất số lẻ.
- **Tương thích ngược dữ liệu (Backward Compatible Migration)**: Tự động trích xuất các sản phẩm hiện có thành đơn vị cơ sở trong bảng `product_units`, không làm thay đổi giá trị tồn kho hay giá bán gốc.

### 9. Bán Hàng Theo Đơn Vị Tính Tại POS (Unit-based POS Selling)
- **Chọn đơn vị trực tiếp trên từng dòng giỏ hàng**: Thu ngân dễ dàng chuyển đổi đơn vị (Lon / Lốc / Thùng) ngay trong POS. Đơn giá, mã vạch và số tiền từng dòng tự động điều chỉnh theo hệ số quy đổi.
- **Kiểm tra tồn kho thời gian thực theo đơn vị cơ sở**: Khi thêm hoặc đổi đơn vị, hệ thống tự động quy đổi sang số lượng đơn vị cơ sở để so sánh với tồn kho thực tế, ngăn chặn triệt để tình trạng bán vượt tồn.
- **Tương thích hoàn hảo với Bảng giá riêng theo Khách hàng**: Khi khách hàng có chính sách giá riêng, đơn giá được quy đổi chính xác theo hệ số của đơn vị đã chọn mà **không bị nhân trùng lặp hệ số**.
- **Xác thực toàn vẹn ở Backend**: Backend kiểm tra và tính toán lại giá, hệ số quy đổi và trừ tồn kho theo đơn vị cơ sở, đảm bảo dữ liệu không bị can thiệp trái phép từ client.

### 10. Quản Lý Đơn Bán Chuyên Biệt & Trạng Thái Đơn Hàng (Order Management & Lifecycle)
- **Màn hình Quản lý Hóa đơn chuyên biệt (`view-orders`)**:
  - Tìm kiếm và lọc đa tiêu chí: mã hóa đơn, tên/số điện thoại khách hàng, trạng thái (`completed`, `pending`, `cancelled`), phương thức thanh toán, khoảng ngày.
  - Phân trang phía máy chủ (Server-side pagination) với kích thước trang linh hoạt (10, 25, 50, 100 dòng), kèm thẻ tổng kết số lượng đơn và doanh thu theo bộ lọc.
  - Xem chi tiết hóa đơn trong Modal trực quan, in lại hóa đơn nhiệt 80mm bất kỳ lúc nào.
- **Vòng đời đơn hàng & Quản lý đơn hàng chờ (Pending Orders)**:
  - Hỗ trợ trạng thái **Đơn hàng chờ (`pending`)**: Lưu đơn hàng nhưng chưa giao ngay. Đơn pending **chưa trừ tồn kho**, **chưa ghi nhận doanh thu** và **chưa tính công nợ**.
  - Theo dõi số lượng và tổng tiền đơn pending theo từng khách hàng.
  - Chức năng **Hoàn tất đơn chờ**: Kiểm tra tồn kho, trừ kho, ghi nhận doanh thu và cập nhật công nợ khi giao hàng.
  - Sửa ghi chú đơn pending ngay trong chi tiết đơn hàng.
- **Hủy hóa đơn an toàn (Safe Order Cancellation & Reversal)**:
  - Quyền hạn riêng `orders:cancel` được kiểm soát nghiêm ngặt bằng RBAC.
  - Nhập lý do hủy bắt buộc.
  - **Cơ chế hoàn tác giao dịch toàn diện**: Tự động hoàn trả tồn kho về trạng thái trước khi bán, ghi phiếu chi hoàn tiền trong sổ quỹ nếu khách đã trả tiền mặt, và cấn trừ lại công nợ khách hàng nếu đơn bán nợ.
- **Nhân bản đơn hàng (Duplicate Order)**: Tải toàn bộ danh sách mặt hàng, đơn vị tính, số lượng và thông tin khách hàng từ hóa đơn cũ vào POS để tạo đơn mới nhanh chóng.

### 11. Xuất Excel Thuần Python OpenXML & Bộ Chọn Cột Linh Hoạt
- **Sinh file `.xlsx` chuẩn OpenXML thuần Python**: Hoàn toàn **không dùng thư viện ngoài (zero external pip packages)** như `openpyxl` hay `pandas`, chỉ sử dụng `zipfile` và template XML của Python Standard Library. Tương thích 100% với Microsoft Excel, Google Sheets, LibreOffice.
- **Xuất dữ liệu cho mọi phân hệ**: Đơn bán hàng, Sản phẩm tồn kho, Khách hàng, Nhà cung cấp, Nhập hàng, Đổi trả hàng, Sổ quỹ.
- **Bộ chọn cột linh hoạt (Column Selector Modal)**: Cho phép người dùng tùy chọn bật/tắt các cột dữ liệu cần xuất hoặc ẩn trên bảng dữ liệu. Cấu hình cột được ghi nhớ tự động trong `localStorage`.
- **Bảo mật giá vốn theo phân quyền (RBAC)**: Thu ngân và Viewer khi xuất file Excel sẽ bị backend **tự động loại bỏ hoàn toàn các cột giá vốn (`cost_price`, `total_cost`)**, ngăn chặn lộ bí mật kinh doanh.

### 12. Quản Lý Khuyến Mãi Đa Phạm Vi (Promotions Engine)
- **Thiết lập chương trình khuyến mãi linh hoạt**:
  - Phạm vi áp dụng: Toàn bộ đơn hàng (`order`), theo danh mục (`category`), hoặc theo từng sản phẩm cụ thể (`product`).
  - Loại chiết khấu: Theo phần trăm (`percentage` %) hoặc số tiền cố định (`fixed_amount` đ).
  - Điều kiện áp dụng: Giá trị đơn hàng tối thiểu (`min_order_amount`), thời gian hiệu lực từ ngày đến ngày.
- **Tự động đề xuất & Áp dụng tại POS**: Khi quét hàng hoặc thêm giỏ hàng, hệ thống tự động kiểm tra các chương trình khuyến mãi đang hoạt động và áp dụng mức giảm tối ưu nhất.
- **Quy tắc không cộng dồn (Non-stacking Rule)**: Ngăn chặn giảm giá trùng lặp giữa khuyến mãi tự động và chiết khấu thủ công.
- **Lưu Snapshot khuyến mãi trong đơn hàng**: Ghi nhận mã khuyến mãi, tên chương trình và số tiền giảm giá trực tiếp vào hóa đơn để phục vụ báo cáo và kiểm toán.

### 13. Ghi Chú Đơn Hàng Riêng Biệt (Dedicated Order Notes)
- Ô nhập ghi chú riêng biệt tại giao diện POS, lưu trực tiếp vào cột `notes` của bảng `orders`.
- Hiển thị ghi chú rõ ràng trên màn hình chi tiết đơn bán và trên phiếu in nhiệt 80mm.
- Tách biệt hoàn toàn giữa ghi chú của thu ngân/khách hàng và các thông điệp ghi nợ tự động của hệ thống.

### 14. An Toàn Kế Toán, Trừ Kho Nguyên Tử & Phím Tắt POS (v4 Enterprise Upgrades)
- **Chuẩn hóa tính toán lợi nhuận khi có hàng trả (Return Margin Accounting)**: Báo cáo Dashboard chỉ khấu trừ phần chênh lệch lợi nhuận của hàng trả `(Giá bán - Giá vốn) * Số lượng`, không trừ toàn bộ giá trị hàng hóa làm sai lệch âm lãi gộp.
- **Xếp hạng tiêu thụ chuẩn xác theo đơn vị cơ sở**: Bảng xếp hạng Top sản phẩm bán chạy tính toán theo `base_quantity`, phản ánh trung thực sản lượng tiêu thụ bất kể khách mua theo Lon, Lốc hay Thùng.
- **Trừ kho nguyên tử chống Race Condition (Atomic Stock Deduction)**: Câu lệnh SQL `UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?` ngăn chặn hoàn toàn lỗi thất thoát tồn kho khi nhiều quầy POS thanh toán đồng thời cùng một mặt hàng.
- **Bảo toàn dữ liệu lịch sử với Soft Delete (`is_active = 0`)**: Sản phẩm, khách hàng hoặc nhà cung cấp đã từng phát sinh chứng từ giao dịch được chuyển sang trạng thái ngừng kinh doanh/giao dịch thay vì xóa cứng, triệt tiêu lỗi hỏng dữ liệu và lỗi khóa ngoại.
- **Sinh mã chứng từ chống trùng lặp (`generate_code`)**: Cơ chế tìm kiếm `MAX(id) + 1` kết hợp vòng lặp kiểm tra trùng lặp đảm bảo không bao giờ sinh trùng mã hóa đơn ngay cả khi có xóa dữ liệu thử nghiệm.
- **Chống Stored XSS toàn diện**: Bổ sung hàm lọc ký tự đặc biệt `escapeHtml()` tại toàn bộ các điểm hiển thị dữ liệu người dùng nhập trong POS và chi tiết đơn hàng.
- **Chặn bấm trùng nút Thanh toán (Checkout Debounce)**: Vô hiệu hóa nút thanh toán và hiển thị trạng thái đang xử lý để ngăn chặn việc gửi đơn hàng kép khi mạng trễ.
- **Giỏ hàng đa tab tại POS (Multi-cart Tabs)**: Thu ngân có thể mở tối đa 5 hóa đơn chờ cùng lúc (`Hóa đơn 1`, `Hóa đơn 2`...) để linh hoạt phục vụ khách hàng tiếp theo khi khách trước tạm giữ đơn.
- **Hệ thống phím tắt quầy thu ngân chuyên nghiệp**: Hỗ trợ `F2` (Tìm kiếm / quét mã vạch), `F4` (Chọn nhanh khách hàng), `F6` (Lưu đơn đặt tạm), `F8` (Thanh toán & in hóa đơn) giúp thao tác tốc độ cao không cần chuột.
- **SQLite WAL Mode & Busy Timeout**: Tự động bật `PRAGMA journal_mode = WAL` và `PRAGMA busy_timeout = 5000` đảm bảo server chịu tải mượt mà cho nhiều máy trạm trong mạng LAN.

---

## 🔒 Khuyến Cáo Bảo Mật Mạng (Security Notice)
> [!WARNING]
> Khi vận hành ứng dụng trong mạng nội bộ (LAN) hoặc qua mạng không tin cậy (Wi-Fi công cộng):
> - **Khuyến nghị sử dụng HTTPS hoặc VPN**: Ứng dụng chạy trên giao thức HTTP tiêu chuẩn, phù hợp cho thử nghiệm hoặc mạng LAN an toàn. Khi đưa vào môi trường sản xuất có dữ liệu thật hoặc nhiều nhân viên truy cập từ xa, hãy đặt ứng dụng sau một reverse proxy hỗ trợ HTTPS (như Nginx, Caddy, Cloudflare Tunnel) hoặc kết nối qua mạng riêng ảo (VPN).
> - **Tuyệt đối không mở port HTTP trần ra Internet công cộng** khi chưa có chứng chỉ SSL/TLS mã hóa đường truyền.

---

## 🗄️ Nâng Cấp Cơ Sở Dữ Liệu & Khôi Phục (Database Migration & Recovery)
- **Tự động sao lưu an toàn trước migration**: Trước mỗi bước nâng cấp schema, hệ thống tự động tạo bản sao lưu nguyên vẹn:
  - `data/kiotviet_backup_pre_v2.db` (trước khi nâng cấp RBAC & Audit)
  - `data/kiotviet_backup_pre_v3.db` (trước khi nâng cấp Đơn vị quy đổi, Khuyến mãi & Vòng đời đơn hàng)
  - `data/kiotviet_backup_pre_v4.db` (trước khi nâng cấp An toàn kế toán, Trừ kho nguyên tử & Soft Delete)
- **Bảng theo dõi Migration (`schema_migrations`)**: Quản lý lịch sử nâng cấp schema có phiên bản:
  - Phiên bản 1 (`v1_initial_schema`): Schema cốt lõi hàng hóa, khách hàng, đơn hàng, sổ quỹ.
  - Phiên bản 2 (`v2_auth_rbac_audit`): Thêm bảng `users`, `sessions`, `audit_logs` và gắn cột `user_id`, `user_name` vào tất cả chứng từ.
  - Phiên bản 3 (`v3_units_promotions_orders`): Thêm bảng `product_units` (đơn vị đóng gói quy đổi), `promotions` (chương trình khuyến mãi), thêm cột `status`, `notes`, `promotion_id`, `promotion_name`, `promotion_discount` vào `orders`, và `unit_id`, `unit_name`, `conversion_rate`, `base_quantity` vào `order_items`, `purchase_items`, `return_items`.
  - Phiên bản 4 (`v4_accounting_safety_and_soft_delete`): Thêm cột `is_active` cho `products`, `customers`, `suppliers` kèm indexes, chuyển sang Soft Delete bảo toàn toàn vẹn dữ liệu kế toán và lịch sử giao dịch.
- **Cách khôi phục dữ liệu**: Nếu muốn khôi phục về trạng thái trước migration, chỉ cần dừng server và copy đè file backup tương ứng thành `kiotviet.db`.

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

## 🧪 Kiểm Thử Tự Động (Automated Test Suites)

Hệ thống đi kèm 3 bộ kiểm thử tự động toàn diện (21/21 Tests Passed), không phụ thuộc bất kỳ thư viện ngoài nào (100% Python Standard Library):

### 1. Kiểm Thử Phân Quyền & Kiểm Toán (`tests/test_auth_audit.py` - 9/9 Passed)
1. `test_01_bootstrap_and_lockdown`: Khởi tạo admin ban đầu an toàn và khóa chặt endpoint bootstrap.
2. `test_02_unauthenticated_requests_blocked`: Chặn 401 với mọi request chưa đăng nhập.
3. `test_03_rbac_permissions_enforced`: Thu ngân bị ẩn giá vốn và chặn nhập kho/sổ quỹ; Kho bị chặn sổ quỹ/đơn bán.
4. `test_04_business_audit_trail_and_timeline`: Ghi audit đầy đủ khi bán hàng và truy vấn timeline thành công.
5. `test_05_account_lock_instant_session_revocation`: Khóa tài khoản thu hồi phiên lập tức, chặn đăng nhập mới.
6. `test_06_audit_logs_immutability`: Chặn sửa/xóa audit log qua API (HTTP 403 `AUDIT_IMMUTABLE`).
7. `test_07_transaction_rollback_on_audit_failure`: Rollback toàn bộ nghiệp vụ nếu audit thất bại.
8. `test_08_sales_return_linked_to_order_timeline`: Trả hàng liên kết chính xác vào timeline của hóa đơn gốc.
9. `test_09_healthz_unauthenticated`: Endpoint kiểm tra trạng thái hoạt động không yêu cầu đăng nhập.

### 2. Kiểm Thử Tính Năng Nâng Cao v3 (`tests/test_v3_features.py` - 7/7 Passed)
1. `test_01_product_units_crud_and_conversion_integrity`: Quản lý đơn vị đóng gói nhiều cấp, validate `conversion_rate > 0`, phân rã tồn kho (`format_stock_breakdown`).
2. `test_02_pos_order_with_packaging_unit_stock_deduction`: Bán hàng theo thùng/lốc tại POS, trừ kho chuẩn xác theo đơn vị cơ sở.
3. `test_03_customer_specific_price_with_packaging_unit`: Bảng giá riêng theo khách hàng kết hợp đơn vị quy đổi không nhân trùng lặp.
4. `test_04_pending_order_and_completion_flow`: Đơn hàng chờ (pending) không trừ kho, khi hoàn tất mới trừ kho và tính công nợ.
5. `test_05_order_cancellation_with_stock_cash_debt_reversal`: Hủy đơn an toàn hoàn trả tồn kho, ghi phiếu chi quỹ và cấn trừ công nợ khách.
6. `test_06_promotions_engine_and_order_snapshot`: Động cơ khuyến mãi tự động, kiểm tra điều kiện, chống cộng dồn chiết khấu, lưu snapshot vào đơn bán.
7. `test_07_openxml_excel_export_and_rbac_cost_masking`: Sinh file `.xlsx` chuẩn OpenXML bằng `zipfile` thuần Python và ẩn giá vốn với Thu ngân/Viewer theo RBAC.

### 3. Kiểm Thử An Toàn Kế Toán & Concurrency v4 (`tests/test_v4_fixes.py` - 5/5 Passed)
1. `test_01_setup_and_login`: Thiết lập tài khoản quản trị và cấp phát token phiên bảo mật.
2. `test_02_dashboard_profit_accounting_correctness`: Xác nhận lợi nhuận gộp Dashboard chỉ khấu trừ phần chênh lệch lợi nhuận của hàng trả, không trừ toàn bộ giá trị hàng hóa làm sai lệch âm lãi.
3. `test_03_return_packaging_unit_and_order_validation`: Quy đổi chính xác đơn vị đóng gói sang đơn vị cơ sở khi trả hàng và chặn vượt số lượng đã mua.
4. `test_04_soft_delete_preservation`: Bảo toàn chứng từ lịch sử bằng Soft Delete (`is_active = 0`), tự động lọc dữ liệu đang hoạt động.
5. `test_05_atomic_stock_deduction`: Xác thực trừ kho nguyên tử (Atomic Update) loại bỏ hoàn toàn race condition và chặn bán vượt tồn khi không cho phép âm kho.

### Chạy toàn bộ kiểm thử (21/21 Tests):
```powershell
cd "C:\Users\DELL\.gemini\antigravity\scratch\kiotviet-pos-app"
& "C:\Users\DELL\AppData\Local\Programs\Python\Python311\python.exe" -m unittest discover -s tests
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
│   ├── auth.py           # Quản lý xác thực, PBKDF2 băm mật khẩu, phiên, phân quyền RBAC
│   ├── database.py       # Khởi tạo SQLite DB, quản lý schema migrations, seed dữ liệu mẫu
│   ├── export_xlsx.py    # Bộ sinh file Excel .xlsx chuẩn OpenXML thuần Python (zipfile + XML)
│   └── server.py         # Multi-threaded HTTP Server, REST API endpoints, MAC cost, Audit
├── frontend/
│   ├── css/
│   │   └── style.css     # Enterprise Design System, theme KiotPro, modal, hóa đơn in nhiệt
│   ├── js/
│   │   ├── api.js        # Service kết nối API RESTful (Auth, Units, Orders, Promos, Export)
│   │   ├── pos.js        # Bán hàng POS, giỏ hàng đa đơn vị, khuyến mãi, ghi chú, hóa đơn
│   │   └── app.js        # Điều hướng SPA, Đơn bán, Khuyến mãi, Chọn cột, Xuất Excel, Audit
│   └── index.html        # Giao diện chính SPA (View Hóa đơn, Khuyến mãi, Modal chọn cột...)
├── tests/
│   ├── test_auth_audit.py   # Test suite xác thực, bảo mật, RBAC và kiểm toán nghiệp vụ
│   ├── test_v3_features.py  # Test suite đơn vị đóng gói, đơn bán, khuyến mãi, Excel OpenXML
│   └── test_v4_fixes.py     # Test suite an toàn kế toán, trừ kho nguyên tử, Soft Delete & Returns
├── data/
│   ├── kiotviet.db                # Cơ sở dữ liệu SQLite chính
│   ├── kiotviet_backup_pre_v2.db  # Bản sao lưu an toàn trước migration v2
│   ├── kiotviet_backup_pre_v3.db  # Bản sao lưu an toàn trước migration v3
│   └── kiotviet_backup_pre_v4.db  # Bản sao lưu an toàn trước migration v4
├── start.bat             # File khởi động nhanh cho Windows
├── start.ps1             # Script khởi động PowerShell
└── README.md             # Tài liệu chi tiết hướng dẫn vận hành và kiến trúc
```
