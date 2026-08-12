export default function Loading() {
  return (
    <main className="app-loading" aria-label="Đang tải Hexagon World">
      <img src="/telegram-loading.svg" alt="Hexagon World" width="144" height="144" />
      <div className="app-loading__title">HEXAGON WORLD</div>
      <div className="app-loading__pulse" aria-hidden="true" />
    </main>
  );
}

