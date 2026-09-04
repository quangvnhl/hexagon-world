import type { Metadata } from "next";
import { LegalPage, Section, legalStyles as s } from "@/components/LegalPage";
import { LEGAL, contactEmail, operatorName } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Điều khoản sử dụng — Hexagon World",
  description: "Điều khoản sử dụng game Hexagon World.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Điều khoản sử dụng"
      subtitle="Đọc trước khi chơi. Mở game nghĩa là bạn đồng ý với những điều dưới đây."
    >
      <Section heading="1. Ai vận hành game này">
        <p style={s.p}>
          Hexagon World do <strong style={s.strong}>{operatorName()}</strong> vận hành
          (&ldquo;chúng tôi&rdquo;). Liên hệ: <a href={`mailto:${contactEmail()}`} style={s.a}>{contactEmail()}</a>.
        </p>
      </Section>

      <Section heading="2. Tuổi tối thiểu">
        <p style={s.p}>
          Bạn phải từ <strong style={s.strong}>{LEGAL.minAge} tuổi</strong> trở lên. Nếu chưa đủ tuổi
          thành niên ở nơi bạn sống, bạn cần sự đồng ý của cha mẹ hoặc người giám hộ, đặc biệt là
          trước khi mua bất cứ thứ gì.
        </p>
      </Section>

      <Section heading="3. Tài khoản">
        <p style={s.p}>
          Bạn đăng nhập bằng tài khoản Telegram. Chúng tôi không đặt mật khẩu riêng và không bao giờ
          nhìn thấy mật khẩu Telegram của bạn. Giữ an toàn cho tài khoản Telegram cũng là giữ an
          toàn cho tiến độ chơi của bạn.
        </p>
        <p style={s.p}>
          Bạn chơi thử được mà không cần đăng nhập. Tiến độ ở chế độ khách nằm trên máy bạn và
          <strong style={s.strong}> có thể mất</strong> khi xoá dữ liệu trình duyệt hoặc đổi thiết bị.
        </p>
      </Section>

      <Section heading="4. Coin, năng lượng và vật phẩm là đồ ảo">
        <p style={s.p}>
          Coin, năng lượng, totem và mọi vật phẩm trong game <strong style={s.strong}>không phải
          tiền</strong> và không có giá trị ngoài game. Bạn nhận được quyền sử dụng chúng trong game,
          chứ không sở hữu chúng.
        </p>
        <ul style={s.ul}>
          <li>Không đổi ngược ra tiền mặt, Stars hay bất cứ tài sản nào.</li>
          <li>Không mua bán, cho tặng hoặc chuyển nhượng giữa các tài khoản.</li>
          <li>Có thể thay đổi giá, tỉ lệ hoặc ngừng cung cấp một vật phẩm khi cân bằng lại game.</li>
          <li>Mất hết khi tài khoản bị xoá — kể cả khi bạn tự xoá.</li>
        </ul>
      </Section>

      <Section heading="5. Mua hàng">
        <p style={s.p}>
          Thanh toán bằng Telegram Stars và <strong style={s.strong}>do Telegram xử lý</strong>.
          Chúng tôi không nhận, không thấy và không lưu thông tin thẻ của bạn. Điều kiện hoàn tiền
          nằm ở trang <a href="/paysupport" style={s.a}>Hỗ trợ thanh toán</a>.
        </p>
      </Section>

      <Section heading="6. Những việc không được làm">
        <ul style={s.ul}>
          <li>Dùng bot, script, trình sửa bộ nhớ hoặc client đã bị sửa để chơi thay hoặc để gian lận.</li>
          <li>Khai thác lỗi để nhận thưởng. Gặp lỗi kiểu đó, báo cho chúng tôi — chúng tôi cảm ơn thật lòng.</li>
          <li>Tấn công, dò quét hoặc gây quá tải máy chủ.</li>
          <li>Dùng tên hiển thị mang tính lăng mạ, thù ghét hoặc mạo danh người khác.</li>
          <li>Bán, cho thuê hoặc chia sẻ tài khoản.</li>
        </ul>
        <p style={s.p}>
          Máy chủ tự kiểm tra kết quả trận và kết quả cấp chiến dịch. Phần thưởng do máy chủ tính,
          không phải do client khai báo, nên chỉnh sửa client sẽ không cho bạn thêm gì ngoài một
          tài khoản bị khoá.
        </p>
      </Section>

      <Section heading="7. Tạm ngưng và chấm dứt">
        <p style={s.p}>
          Chúng tôi có thể tạm ngưng hoặc chấm dứt tài khoản vi phạm mục 6. Với vi phạm nghiêm trọng
          (gian lận có hệ thống, tấn công hạ tầng, gian lận thanh toán) việc này có thể diễn ra ngay
          và không báo trước. Bạn có quyền khiếu nại qua email ở mục 1; chúng tôi sẽ xem lại.
        </p>
        <p style={s.p}>
          Tài khoản bị chấm dứt vì vi phạm <strong style={s.strong}>không được hoàn tiền</strong> cho
          phần đã mua.
        </p>
      </Section>

      <Section heading="8. Game được cung cấp ở trạng thái hiện có">
        <p style={s.p}>
          Chúng tôi cố gắng giữ game chạy tốt nhưng không cam kết chạy liên tục, không lỗi, hay giữ
          nguyên mọi tính năng. Chúng tôi có thể cập nhật, đổi cân bằng, hoặc ngừng một chế độ chơi.
          Nếu phải đóng game hẳn, chúng tôi sẽ thông báo trước qua kênh Telegram chính thức và ngừng
          bán vật phẩm mới trước ngày đóng.
        </p>
      </Section>

      <Section heading="9. Giới hạn trách nhiệm">
        <p style={s.p}>
          Trong phạm vi pháp luật cho phép, chúng tôi không chịu trách nhiệm cho thiệt hại gián tiếp
          phát sinh từ việc dùng game. Trách nhiệm của chúng tôi trong mọi trường hợp không vượt quá
          số tiền bạn đã trả cho game trong <strong style={s.strong}>6 tháng</strong> gần nhất.
        </p>
        <p style={s.p}>
          Điều khoản này không loại trừ những quyền mà pháp luật bảo vệ người tiêu dùng dành cho bạn
          và không thể bị từ bỏ.
        </p>
      </Section>

      <Section heading="10. Thay đổi điều khoản">
        <p style={s.p}>
          Khi có thay đổi đáng kể, chúng tôi sẽ cập nhật ngày ở chân trang và thông báo trong game
          trước khi thay đổi có hiệu lực. Tiếp tục chơi sau ngày hiệu lực nghĩa là bạn đồng ý với
          bản mới.
        </p>
      </Section>

      <Section heading="11. Luật áp dụng">
        <p style={s.p}>
          Điều khoản này áp dụng theo pháp luật {LEGAL.jurisdiction}. Chúng tôi mong giải quyết mọi
          việc qua email trước khi cần đến bất kỳ thủ tục nào khác.
        </p>
      </Section>
    </LegalPage>
  );
}
