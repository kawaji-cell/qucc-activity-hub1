import type { Metadata } from 'next';
import Link from 'next/link';
import {
  APP_NAME,
  STRAVA_API_AGREEMENT_URL,
  STRAVA_MANAGE_APPS_URL,
  STRAVA_PRIVACY_URL,
  SUPPORT_EMAIL,
  SUPPORT_MAILTO,
} from '@/lib/site';

export const metadata: Metadata = {
  title: `Privacy Policy | ${APP_NAME}`,
  description: `${APP_NAME} のプライバシーポリシー`,
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

export default function PrivacyPage() {
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
          <h1 className="mt-4 text-4xl font-black tracking-tight text-[#85023e]">
            Privacy Policy
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-gray-600">
            {APP_NAME} は、九州大学サイクリング同好会の部員同士でライド記録を共有するための
            コミュニティアプリです。このページでは、Strava 連携によって取得する情報と、
            その利用方法を説明します。
          </p>
        </div>

        <Section title="1. 取得する情報">
          <p>本アプリは、Strava API を通じて以下の情報を取得します。</p>
          <p>ライドの名称、距離、獲得標高、開始日時、ルートのサマリーポリライン。</p>
          <p>Strava アスリートの表示名など、連携に必要な基本プロフィール情報。</p>
          <p>入学年度やプロフィール文など、本アプリ内でユーザー自身が登録・編集した情報。</p>
        </Section>

        <Section title="2. 利用目的">
          <p>
            取得した情報は、QUCC メンバーの活動可視化、走行ルート共有、年間の走行実績表示のためにのみ利用します。
          </p>
          <p>
            承認された QUCC メンバーおよび運営管理者は、アプリ内で共有対象となったルートと集計値を閲覧できます。
          </p>
        </Section>

        <Section title="3. 共有と保存">
          <p>
            連携したデータは、{APP_NAME} 内でのみ表示し、第三者へ販売または提供しません。
          </p>
          <p>
            Strava 連携を解除したい場合は{' '}
            <a
              href={STRAVA_MANAGE_APPS_URL}
              target="_blank"
              rel="noreferrer"
              className="font-bold text-[#FC4C02] underline"
            >
              Strava のアプリ設定
            </a>
            から接続を見直せます。同期済みデータの削除は{' '}
            <a href={SUPPORT_MAILTO} className="font-bold text-[#FC4C02] underline">
              {SUPPORT_EMAIL}
            </a>
            までご連絡ください。
          </p>
        </Section>

        <Section title="4. Strava による情報取得について">
          <p>
            Strava は、Strava API の利用状況に関するデータを収集・利用する場合があります。詳細は Strava の{' '}
            <a
              href={STRAVA_API_AGREEMENT_URL}
              target="_blank"
              rel="noreferrer"
              className="font-bold text-[#FC4C02] underline"
            >
              API Agreement
            </a>{' '}
            および{' '}
            <a
              href={STRAVA_PRIVACY_URL}
              target="_blank"
              rel="noreferrer"
              className="font-bold text-[#FC4C02] underline"
            >
              Privacy Policy
            </a>
            をご確認ください。
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
