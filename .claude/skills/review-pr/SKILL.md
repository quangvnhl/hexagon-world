---
name: review-pr
description: Review một pull request của repo này theo luật trong AGENTS.md, rồi tuỳ chọn đăng nhận xét lên GitHub. Nhận số PR, hoặc để trống để review nhánh hiện tại.
argument-hint: "[số PR] [--post]"
disable-model-invocation: true
allowed-tools: Bash(node scripts/review-collect.mjs:*), Bash(node scripts/review-guard.mjs:*), Bash(gh pr view:*), Bash(gh pr diff:*), Bash(gh pr checkout:*), Bash(gh pr comment:*), Read, Grep, Glob
---

Review pull request **$0** của dự án Hexagon World. Nếu không có số PR thì review nhánh hiện tại.

Giao việc cho subagent `review-pr` (định nghĩa ở `.claude/agents/review-pr.md`) — nó đã có sẵn luật
của repo, danh sách những gì cổng tất định đã kiểm, và các điểm cần soát.

Truyền cho nó:

- Số PR (nếu có): **$0**
- Có đăng lên GitHub không: chỉ đăng khi lệnh có `--post` trong `$ARGUMENTS`. Không có thì trả kết
  quả về đây để người đọc trước.

Sau khi subagent xong, tóm tắt lại cho người dùng: số phát hiện theo mức nghiêm trọng, cái nào cần
sửa trước khi gộp, cái nào cố ý chấp nhận. Nếu có phát hiện nghiêm trọng thì nói rõ **không nên gộp
cho tới khi sửa**.

Không tự sửa code trong lượt này trừ khi người dùng bảo sửa.
