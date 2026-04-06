import type { Metadata } from 'next';
import Link from 'next/link';
import { APP_NAME, STRAVA_MANAGE_APPS_URL, SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/site';

export const metadata: Metadata = {
  title: `Terms | ${APP_NAME}`,
  description: `${APP_NAME} の利用規約`,
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-orange-100 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-black tracking-tight text-[#85023e]">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-7 text-gray-600">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#fff8f3] px-4 py-10 text-gray-900">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <Link
            href="/"
            className="text-xs font-black uppercase tracking-[0.2em] text-[#FC4C02]"
          >
            Back to QUCC Hub
          </Link>
          <h1 className="mt-4 text-4xl font-black tracking-tight text-[#85023e]">Terms</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-gray-600">
            {APP_NAME} は、九州大学サイクリング同好会のコミュニティ利用を目的としたアプリです。
            利用にあたっては、以下の内容に同意したものとみなします。
          </p>
        </div>

        <Section title="1. 利用資格">
          <p>本アプリは、九州大学サイクリング同好会の現役部員および OB・OG を対象としています。</p>
          <p>運営管理者は、登録内容を確認したうえで表示権限を承認または停止できます。</p>
        </Section>

        <Section title="2. データ共有への同意">
          <p>
            Strava を連携すると、承認済み QUCC メンバーがアプリ内であなたの共有対象ルートとライド集計を閲覧できるようになります。
          </p>
          <p>
            接続解除は{' '}
            <a
              href={STRAVA_MANAGE_APPS_URL}
              target="_blank"
              rel="noreferrer"
              className="font-bold text-[#FC4C02] underline"
            >
              Strava のアプリ設定
            </a>
            から行えます。同期済みデータの削除を希望する場合は{' '}
            <a href={SUPPORT_MAILTO} className="font-bold text-[#FC4C02] underline">
              {SUPPORT_EMAIL}
            </a>
            へご連絡ください。
          </p>
        </Section>

        <Section title="3. 禁止事項">
          <p>本アプリのデータを不正に抽出、改ざん、再配布すること。</p>
          <p>他の部員のプライバシーを侵害する行為や、コミュニティ運営を妨げる行為。</p>
        </Section>

        <Section title="4. 免責事項">
          <p>
            本アプリの利用により生じたトラブルや事故について、開発者および運営者は責任を負いません。安全に配慮して走行してください。
          </p>
        </Section>

        <Section title="5. お問い合わせ">
          <p>
            サポート窓口: <a href={SUPPORT_MAILTO} className="font-bold text-[#FC4C02] underline">{SUPPORT_EMAIL}</a>
          </p>
        </Section>
      </div>
    </main>
  );
}
