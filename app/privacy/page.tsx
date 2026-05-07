export const metadata = {
  title: 'Privacy — CYAM Hevy Challenge',
};

export default function PrivacyPage() {
  return (
    <main className="max-w-2xl mx-auto px-6 py-16">
      <h1 className="font-display text-4xl uppercase mb-6">Privacy</h1>

      <div className="prose prose-invert text-bone/85 leading-relaxed space-y-4">
        <p>
          CYAM Hevy Challenge is a private accountability tool used by a small
          group of friends. It is not a commercial application.
        </p>
        <h2 className="font-display text-xl uppercase mt-8 mb-2">What we collect</h2>
        <p>
          When you authorize the app via Strava, we receive and store: your
          Strava athlete ID, first name and last initial (or a name you choose),
          profile picture URL, and an OAuth refresh token used to read your
          activities.
        </p>
        <p>
          On a daily schedule, we read your recent activity list to identify
          qualifying workouts (Weight Training and Run, 30+ minutes). We store
          the activity ID, type, duration, and timestamp. We do not read GPS
          tracks, heart rate streams, or any other detailed data.
        </p>
        <h2 className="font-display text-xl uppercase mt-8 mb-2">What we never do</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>We never post, comment, or kudos on your behalf.</li>
          <li>We never share your data with third parties.</li>
          <li>We never use your data for advertising or analytics.</li>
        </ul>
        <h2 className="font-display text-xl uppercase mt-8 mb-2">Removing your data</h2>
        <p>
          You can revoke access at any time via your Strava settings
          (strava.com/settings/apps). On request, the organizer will delete
          your stored records from the database.
        </p>
        <h2 className="font-display text-xl uppercase mt-8 mb-2">Contact</h2>
        <p>
          Questions go to the organizer in the group chat.
        </p>
      </div>

      <a
        href="/"
        className="inline-block mt-12 text-sm text-flame underline"
      >
        ← Back to dashboard
      </a>
    </main>
  );
}
