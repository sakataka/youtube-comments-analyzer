import { Button } from "./ui/button";

type Props = {
  report?: boolean;
  onHome?: () => void;
  onOpenSettings: () => void;
  onNewAnalysis?: () => void;
};

export function AppHeader({ report = false, onHome, onOpenSettings, onNewAnalysis }: Props) {
  return (
    <header className={report ? "product-header product-header--report" : "product-header"}>
      {onHome ? (
        <Button className="product-name product-name--button" variant="ghost" type="button" onClick={onHome}>
          コメントインサイト
        </Button>
      ) : (
        <Button className="product-name" variant="ghost" asChild>
          <a href="/" aria-label="コメントインサイト ホーム">コメントインサイト</a>
        </Button>
      )}
      <div className="header-actions">
        <Button className="text-button" variant="link" type="button" data-dialog-trigger="settings" onClick={onOpenSettings}>設定</Button>
        {onNewAnalysis ? <Button type="button" onClick={onNewAnalysis}>新しい動画を分析</Button> : null}
      </div>
    </header>
  );
}
