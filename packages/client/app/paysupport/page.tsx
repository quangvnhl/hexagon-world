import type { Metadata } from "next";
import { LegalPage, Section, legalStyles as s } from "@/components/LegalPage";
import { LEGAL, contactEmail, operatorName } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Hỗ trợ thanh toán — Hexagon World",
  description: "Mua Telegram Stars trong Hexagon World: giao hàng, hoàn tiền, cách liên hệ.",
};

/**
 * doc 35 §C4 — trang này là ĐIỀU KIỆN của Telegram để bật thanh toán Stars: phải có kênh hỗ trợ
 * thật, nêu rõ chính sách hoàn tiền. Nội dung ở đây phải khớp với câu trả lời của lệnh `/paysupport`
 * trong bot (doc 37 Việc 4) — hai chỗ nói khác nhau là đủ để bị từ chối duyệt.
 */
export default function PaySupportPage() {
  return (
    <LegalPage
      title="Hỗ trợ thanh toán"
      subtitle="Mua bằng Telegram Stars: hàng về khi nào, hỏng thì làm gì, hoàn tiền ra sao."
    >
      <Section heading="Bạn mua bằng gì">
        <p style={s.p}>
          Mọi khoản mua trong Hexagon World đều thanh toán bằng <strong style={s.strong}>Telegram
          Stars (XTR)</strong> và <strong style={s.strong}>do Telegram xử lý</strong>. Chúng tôi
          không nhận, không thấy và không lưu thông tin thẻ của bạn. Cách nạp Stars, và các câu hỏi
          về chính Stars, thuộc phía Telegram.
        </p>
      </Section>

      <Section heading="Hàng về khi nào">
        <p style={s.p}>
          <strong style={s.strong}>Ngay lập tức</strong>, tự động, sau khi Telegram báo thanh toán
          thành công. Coin vào ví trong vài giây.
        </p>
        <p style={s.p}>
          Mỗi giao dịch được ghi theo mã giao dịch riêng của Telegram, nên nếu Telegram gửi lại
          thông báo (mạng chập chờn) thì đơn <strong style={s.strong}>không</strong> bị cộng hai
          lần — và cũng không bị trừ hai lần.
        </p>
      </Section>

      <Section heading="Đã trừ Stars mà chưa nhận được hàng">
        <p style={s.p}>Làm theo thứ tự này, phần lớn trường hợp dừng ở bước 1:</p>
        <ul style={s.ul}>
          <li>Đóng game rồi mở lại. Ví được đọc lại từ máy chủ mỗi lần mở.</li>
          <li>Đợi <strong style={s.strong}>5 phút</strong>. Thông báo từ Telegram thỉnh thoảng về chậm.</li>
          <li>Vẫn chưa thấy: gửi email cho chúng tôi theo mẫu ở cuối trang. Chúng tôi tra bằng mã giao dịch và giao bù, hoặc hoàn Stars nếu không giao được.</li>
        </ul>
      </Section>

      <Section heading="Hoàn tiền">
        <p style={s.p}>
          Chúng tôi hoàn Stars trong vòng <strong style={s.strong}>{LEGAL.refundWindowDays} ngày</strong> kể
          từ lúc giao dịch thành công, nếu:
        </p>
        <ul style={s.ul}>
          <li>Bạn đã trả Stars nhưng <strong style={s.strong}>không nhận được</strong> thứ đã mua, và chúng tôi không giao bù được.</li>
          <li>Bạn bị trừ <strong style={s.strong}>hai lần</strong> cho cùng một đơn.</li>
          <li>Lỗi của chúng tôi khiến thứ bạn mua không dùng được.</li>
          <li>Giao dịch <strong style={s.strong}>không phải do bạn thực hiện</strong> — báo ngay, chúng tôi xử lý cả việc bảo vệ tài khoản.</li>
        </ul>
        <p style={s.p}>Chúng tôi <strong style={s.strong}>không</strong> hoàn trong các trường hợp:</p>
        <ul style={s.ul}>
          <li>Đã <strong style={s.strong}>tiêu hết</strong> coin hoặc năng lượng đã mua. Nhận đúng hàng rồi dùng hết thì giao dịch đã hoàn tất.</li>
          <li>Đổi ý sau khi đã nhận đúng thứ mình chọn.</li>
          <li>Quá {LEGAL.refundWindowDays} ngày, trừ khi pháp luật {LEGAL.jurisdiction} buộc chúng tôi phải hoàn.</li>
          <li>Tài khoản bị khoá vì gian lận hoặc vi phạm <a href="/terms" style={s.a}>Điều khoản sử dụng</a>.</li>
        </ul>
        <p style={s.p}>
          Stars được hoàn về thẳng tài khoản Telegram của bạn qua cơ chế hoàn tiền của Telegram —
          chúng tôi không chuyển tiền mặt và không hoàn bằng đường nào khác. Phần coin tương ứng sẽ
          bị trừ khỏi ví.
        </p>
      </Section>

      <Section heading="Liên hệ">
        <p style={s.p}>
          Email: <a href={`mailto:${contactEmail()}`} style={s.a}>{contactEmail()}</a>
          {LEGAL.contactTelegram && <> · Telegram: <strong style={s.strong}>{LEGAL.contactTelegram}</strong></>}
        </p>
        <p style={s.p}>Kèm bốn thứ sau thì chúng tôi xử lý được ngay từ thư đầu tiên:</p>
        <ul style={s.ul}>
          <li>@username Telegram của bạn.</li>
          <li><strong style={s.strong}>Mã giao dịch</strong> — mở phần Stars trong Telegram, chọn giao dịch, sao chép mã ở đó.</li>
          <li>Ngày giờ mua và tên gói.</li>
          <li>Ảnh chụp màn hình chỗ bị lỗi, nếu có.</li>
        </ul>
        <p style={s.p}>
          Chúng tôi trả lời trong vòng <strong style={s.strong}>3 ngày làm việc</strong> và giải
          quyết xong trong vòng <strong style={s.strong}>14 ngày</strong>. Đơn vị chịu trách nhiệm:{" "}
          <strong style={s.strong}>{operatorName()}</strong>.
        </p>
      </Section>
    </LegalPage>
  );
}
