---
name: karpathy-guidelines
description: Behavioral guidelines to reduce common LLM coding mistakes. Use when writing, reviewing, or refactoring code to avoid overcomplication, make surgical changes, surface assumptions, and define verifiable success criteria.
license: MIT
---

# Karpathy Guidelines

Behavioral guidelines to reduce common LLM coding mistakes, derived from [Andrej Karpathy's observations](https://x.com/karpathy/status/2015883857489522876) on LLM coding pitfalls.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

<!-- ======================= PHẦN RIÊNG CỦA REPO NÀY ======================= -->
<!-- Mọi thứ TRÊN dòng phân cách này là bản sao NGUYÊN VĂN của upstream:      -->
<!--   multica-ai/andrej-karpathy-skills @ 2c60614                            -->
<!--   skills/karpathy-guidelines/SKILL.md                                    -->
<!-- Đừng sửa phần trên. Muốn cập nhật thì tải lại file gốc rồi dán lại phần  -->
<!-- dưới — nhờ vậy `git diff` sau mỗi lần đồng bộ chỉ cho thấy thay đổi thật -->
<!-- của upstream, không lẫn với ghi chú của ta.                              -->

## Áp dụng trong repo Hexagon World

`AGENTS.md` vẫn là **luật**; bộ này là **cách làm việc**. Khi hai bên nói khác nhau về cùng một
việc, `AGENTS.md` thắng — nó chứa những điều cấm không thể thương lượng (không chạm `.env`, không
migrate lên production, không `push --force`, không commit khi CI đỏ).

Ba chỗ bộ này giao với thực tế dự án, đã chốt với chủ dự án ngày 2026-09-08:

### §1 — "chưa rõ thì dừng và hỏi" ÁP DỤNG, và nó THAY cho lệ cũ

Trước đây dự án chạy theo lệ *"tự chạy hết kế hoạch, đừng hỏi"*. **Lệ đó không còn.** Gặp chỗ diễn
giải được theo hai cách mà hai cách dẫn tới việc khác nhau ⇒ **dừng, nêu rõ chỗ mơ hồ, hỏi** —
không tự chọn một cách rồi đi tiếp.

Điều này khớp với `AGENTS.md` §0.5 (*"bí, thiếu thông tin ⇒ `status: blocked` kèm lý do, dừng lại"*),
vốn đã có sẵn nhưng ít được dùng tới.

Vẫn **không** cần hỏi khi: chỉ có một cách hiểu hợp lý; hoặc chọn sai thì sửa rẻ và thấy ngay
(tên biến, chỗ đặt file, thứ tự hai bước độc lập).

### §3 — "đừng sửa lân cận", có MỘT ngoại lệ: chú thích SAI

Giữ nguyên với code: không refactor, không đổi định dạng, không dọn code chết có sẵn — chỉ **nêu ra**.

Ngoại lệ: **một chú thích mô tả sai điều đang xảy ra thì được sửa**, kể cả khi nó nằm cạnh chỗ ta
đụng chứ không phải do ta viết. Lý do: chú thích sai là thứ người sau tin mà không kiểm, nên để lại
tốn hơn nhiều so với một dòng diff thêm. Sửa xong phải **nói rõ trong commit/PR** rằng đó là sửa
lân cận, cùng với chỗ sai là gì.

Không mở rộng ngoại lệ này thành "viết lại cho hay hơn": chỉ áp dụng khi chú thích **sai sự thật**,
không áp dụng khi nó chỉ vụng.

### §2 — "không trừu tượng hoá cho code dùng một lần" KHÔNG cấm việc tách phần thuần

Repo này liên tục tách logic thuần ra file riêng để test được bằng dữ liệu — `ftueSteps.ts`,
`ftueFunnel.ts`, `campaign-sanity.ts`, phần thuần của `ops-keys.service.ts`. Nhìn qua thì giống
"trừu tượng hoá cho code dùng một lần", nhưng nó phục vụ `AGENTS.md` §2 (*"nghiệm thu bằng số,
không bằng mắt"*): thứ được tách ra là thứ **hỏng âm thầm** — luật vượt bước, ngưỡng chống gian
lận, phép đo funnel — và tách ra là cách duy nhất kiểm được chúng mà không dựng cả trình duyệt.

Ranh giới: tách vì **kiểm được** thì đúng; tách vì "sau này có thể cần" thì đúng là thứ §2 cấm.
