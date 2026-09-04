import type { Metadata } from "next";
import { LegalPage, Section, legalStyles as s } from "@/components/LegalPage";
import { DATA_COLLECTED, DATA_NOT_COLLECTED, LEGAL, contactEmail, operatorName } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Chính sách riêng tư — Hexagon World",
  description: "Hexagon World thu thập dữ liệu gì, để làm gì, giữ bao lâu.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Chính sách riêng tư"
      subtitle="Bảng dưới đây liệt kê đúng những gì game thật sự lưu — viết theo schema database, không phải theo trí nhớ."
    >
      <Section heading="Tóm tắt">
        <ul style={s.ul}>
          <li>Đăng nhập bằng Telegram. Chúng tôi <strong style={s.strong}>không bao giờ</strong> thấy mật khẩu Telegram của bạn.</li>
          <li>Thanh toán do Telegram xử lý. Chúng tôi <strong style={s.strong}>không nhận và không lưu</strong> số thẻ.</li>
          <li>Không bán dữ liệu. Không có mạng quảng cáo theo dõi xuyên ứng dụng.</li>
          <li>Số liệu sử dụng gắn với <strong style={s.strong}>mã thiết bị ngẫu nhiên</strong>, không gắn danh tính, và tự xoá sau {LEGAL.analyticsRetentionDays} ngày.</li>
        </ul>
      </Section>

      <Section heading="1. Chúng tôi lưu gì">
        <div style={{ overflowX: "auto" }}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Dữ liệu</th>
                <th style={s.th}>Để làm gì</th>
                <th style={s.th}>Giữ bao lâu</th>
              </tr>
            </thead>
            <tbody>
              {DATA_COLLECTED.map((item) => (
                <tr key={item.what}>
                  <td style={s.td}>{item.what}</td>
                  <td style={s.td}>{item.why}</td>
                  <td style={s.td}>{item.keptFor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section heading="2. Chúng tôi không làm gì">
        <ul style={s.ul}>
          {DATA_NOT_COLLECTED.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </Section>

      <Section heading="3. Ai khác chạm vào dữ liệu">
        <p style={s.p}>
          Chúng tôi không bán và không chia sẻ dữ liệu cho mục đích quảng cáo. Dữ liệu chỉ đi qua các
          bên cần thiết để game chạy được:
        </p>
        <ul style={s.ul}>
          <li><strong style={s.strong}>Telegram</strong> — xác thực danh tính và xử lý thanh toán Stars. Telegram có chính sách riêng tư riêng của họ.</li>
          <li><strong style={s.strong}>Nhà cung cấp hạ tầng đám mây</strong> — nơi đặt database và máy chủ game. Họ lưu trữ dữ liệu thay chúng tôi và không được dùng nó cho việc khác.</li>
        </ul>
        <p style={s.p}>
          Ngoài ra, chúng tôi chỉ cung cấp dữ liệu khi pháp luật yêu cầu hợp lệ.
        </p>
      </Section>

      <Section heading="4. Quyền của bạn">
        <ul style={s.ul}>
          <li><strong style={s.strong}>Xem và lấy bản sao</strong> dữ liệu của bạn.</li>
          <li><strong style={s.strong}>Sửa</strong> thông tin sai (ví dụ tên hiển thị).</li>
          <li><strong style={s.strong}>Xoá</strong> tài khoản và dữ liệu gắn với nó.</li>
          <li><strong style={s.strong}>Rút lại</strong> sự đồng ý bằng cách ngừng chơi và xoá tài khoản.</li>
        </ul>
        <p style={s.p}>
          Gửi yêu cầu tới <a href={`mailto:${contactEmail()}`} style={s.a}>{contactEmail()}</a> từ tài
          khoản Telegram của bạn hoặc kèm @username, để chúng tôi xác minh đúng người. Chúng tôi trả
          lời trong vòng <strong style={s.strong}>30 ngày</strong>.
        </p>
      </Section>

      <Section heading="5. Xoá tài khoản">
        <p style={s.p}>
          Khi bạn yêu cầu xoá, tài khoản bị vô hiệu ngay và dữ liệu chơi bị xoá hẳn sau{" "}
          <strong style={s.strong}>{LEGAL.deletionGraceDays} ngày</strong> — khoảng chờ này để bạn
          đổi ý và để chúng tôi xử lý xong tranh chấp thanh toán nếu có.
        </p>
        <p style={s.p}>
          Hai thứ <strong style={s.strong}>không</strong> bị xoá theo, và bạn nên biết trước:
        </p>
        <ul style={s.ul}>
          <li>
            <strong style={s.strong}>Chứng từ giao dịch</strong> — pháp luật buộc phải lưu hồ sơ kế
            toán trong một thời hạn nhất định. Phần này giữ tách riêng và không dùng cho việc gì khác.
          </li>
          <li>
            <strong style={s.strong}>Sự kiện sử dụng ẩn danh</strong> — chúng đã không gắn với danh
            tính của bạn ngay từ đầu, nên không còn cách nào tìm ra chúng thuộc về ai để mà xoá.
            Chúng tự hết hạn sau {LEGAL.analyticsRetentionDays} ngày.
          </li>
        </ul>
      </Section>

      <Section heading="6. Trẻ em">
        <p style={s.p}>
          Game không dành cho người dưới {LEGAL.minAge} tuổi và chúng tôi không cố ý thu thập dữ liệu
          của trẻ dưới độ tuổi đó. Nếu bạn là cha mẹ hoặc người giám hộ và cho rằng con mình đã tạo
          tài khoản, hãy báo cho chúng tôi — chúng tôi sẽ xoá.
        </p>
      </Section>

      <Section heading="7. Bảo mật">
        <p style={s.p}>
          Kết nối được mã hoá. Dữ liệu người chơi nằm sau khoá truy cập ở tầng database và không mở
          cho người dùng cuối đọc trực tiếp. Số liệu phân tích được lọc bỏ email, tên hiển thị và
          token ở <strong style={s.strong}>cả hai phía</strong> trước khi ghi, nên chúng không thể
          lọt vào bảng sự kiện kể cả khi có ai đó vô ý gửi lên.
        </p>
        <p style={s.p}>
          Không hệ thống nào an toàn tuyệt đối. Nếu xảy ra sự cố ảnh hưởng tới dữ liệu của bạn, chúng
          tôi sẽ thông báo qua kênh Telegram chính thức và qua email liên hệ ở đây.
        </p>
      </Section>

      <Section heading="8. Thay đổi chính sách">
        <p style={s.p}>
          Khi có thay đổi đáng kể, chúng tôi cập nhật ngày ở chân trang và thông báo trong game. Bản
          này do <strong style={s.strong}>{operatorName()}</strong> chịu trách nhiệm.
        </p>
      </Section>
    </LegalPage>
  );
}
