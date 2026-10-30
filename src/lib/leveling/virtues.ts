import { dayOfYear, dkey, yday } from "./dates.js";
import type { Release, Stats } from "./types.js";

export interface Virtue {
  n: string;
  /** Scripture reference. */
  r: string;
  /** The principle in plain words. */
  p: string;
  /** One task for today. */
  t: string;
  /** One of the nine fruit of the Spirit (Galatians 5:22-23). */
  fruit?: boolean;
}

export const VIRTUES: Virtue[] = [
  { n: "Patience", r: "James 1:19", p: "Be quick to listen, slow to speak and slow to anger.", t: "In every conversation today, let the other person finish completely before you answer.", fruit: true },
  { n: "Gratitude", r: "1 Thessalonians 5:18", p: "Give thanks in every circumstance, not only the good ones.", t: "Write down three specific things you are grateful for, then thank one person directly." },
  { n: "Kindness", r: "Ephesians 4:32", p: "Be kind and tender-hearted to one another.", t: "Do one unprompted kind thing for someone who cannot pay you back.", fruit: true },
  { n: "Humility", r: "Philippians 2:3", p: "Do nothing from selfish ambition; count others as more significant than yourself.", t: "Ask someone for honest feedback today and act on one point of it." },
  { n: "Self-control", r: "Proverbs 25:28", p: "A person without self-control is like a city with broken walls.", t: "Pick one impulse (a spend, scrolling, a snap reply) and say no to it today.", fruit: true },
  { n: "Forgiveness", r: "Colossians 3:13", p: "Bear with each other and forgive as the Lord forgave you.", t: "Let go of one grudge. Pray for that person by name." },
  { n: "Generosity", r: "2 Corinthians 9:7", p: "Give freely and cheerfully, not reluctantly.", t: "Give something today: your time, a meal, or money to someone in need." },
  { n: "Honesty", r: "Proverbs 12:22", p: "God delights in people who are trustworthy in what they say.", t: "Be fully straight in every client and work conversation today, even when it is awkward." },
  { n: "Diligence", r: "Colossians 3:23", p: "Work at everything wholeheartedly, as working for the Lord.", t: "Finish your hardest admin task before lunch." },
  { n: "Peace", r: "Philippians 4:6-7", p: "Bring every worry to God in prayer, and his peace will guard your heart.", t: "The moment you feel anxious today, stop and pray about it before acting.", fruit: true },
  { n: "Joy", r: "Nehemiah 8:10", p: "The joy of the Lord is your strength.", t: "Spend 15 minutes on something that genuinely makes you glad, and thank God for it.", fruit: true },
  { n: "Faithfulness", r: "Luke 16:10", p: "Whoever is faithful in small things will be faithful in large ones.", t: "Keep every small promise you make today, on time.", fruit: true },
  { n: "Gentleness", r: "Proverbs 15:1", p: "A gentle answer turns away anger; a harsh word stirs it up.", t: "Answer the next frustration that comes your way with a calm, soft reply.", fruit: true },
  { n: "Love", r: "1 Corinthians 13:4-5", p: "Love is patient and kind; it does not keep a record of wrongs.", t: "Tell someone you love exactly why they matter to you.", fruit: true },
  { n: "Goodness", r: "Galatians 6:9-10", p: "Do not grow tired of doing good; do good to everyone you can.", t: "Do something good for someone outside your usual circle today.", fruit: true },
  { n: "Wisdom", r: "James 1:5", p: "If you lack wisdom, ask God, who gives generously.", t: "Before one real decision today, pause, pray, and if you can, sleep on it." },
  { n: "Contentment", r: "Philippians 4:11-12", p: "Learn to be content whether you have plenty or little.", t: "Go the whole day without buying anything you do not need." },
  { n: "Stewardship", r: "Proverbs 21:20", p: "The wise store up; the foolish spend everything they get.", t: "Review this month's spending and move one amount into savings." },
  { n: "Rest", r: "Mark 6:31", p: "Jesus told his disciples to come away to a quiet place and rest.", t: "Take a full hour offline, with no screens." },
  { n: "Courage", r: "Joshua 1:9", p: "Be strong and courageous; God is with you wherever you go.", t: "Make the call or send the message you have been avoiding." },
  { n: "Encouragement", r: "1 Thessalonians 5:11", p: "Encourage one another and build each other up.", t: "Send a sincere, specific encouraging message to a friend or colleague." },
  { n: "Wholesome speech", r: "Ephesians 4:29", p: "Let only words that build others up come out of your mouth.", t: "No complaining or gossip today. Catch yourself and reframe it." },
  { n: "Servanthood", r: "Mark 10:45", p: "Jesus came not to be served but to serve.", t: "Serve someone at home or work today without being asked." },
  { n: "Prayer", r: "1 Thessalonians 5:17", p: "Pray continually, as a habit through the day.", t: "Pray at three set times today: morning, midday and night." },
  { n: "The Word", r: "Psalm 119:105", p: "Scripture is a lamp for your feet and a light for your path.", t: "Read the chapter of Proverbs matching today's date and write down one line to live by." },
];

/** Today's virtue rotates by day of year; `swap` steps through alternatives. */
export function todayVirtue(now: Date = new Date(), swap = 0): Virtue {
  return VIRTUES[(dayOfYear(now) + swap) % VIRTUES.length];
}

export const VIRTUE_XP = 20;

/** Stats mutation for completing today's virtue. */
export function completeVirtue(st: Stats, v: Virtue, now: Date = new Date()): void {
  const o = st.virtue || { count: 0, fruits: [] };
  const streak = o.last === yday(now) ? (o.streak || 0) + 1 : 1;
  st.virtue = {
    ...o,
    last: dkey(now),
    name: v.n,
    count: (o.count || 0) + 1,
    streak,
    fruits: v.fruit ? [...new Set([...(o.fruits || []), v.n])] : o.fruits || [],
  };
}

/* Release Reset: adapted from the "Released" guide (Our Father collection). Day prompts paraphrased. */
export interface RRDay {
  t: string;
  r: string;
  p: string;
  commit?: boolean;
}

export const RR_DAYS: RRDay[] = [
  { t: "Tell the truth", r: "Psalm 139:23-24", p: "Write down what happened, what you wanted and what you are grieving. Mark which parts are facts and which are explanations you have added. Bring all of it honestly to God." },
  { t: "Drop the tracking number", r: "Philippians 4:6-7", p: "Pick one checking habit, like a profile, an inbox or asking around for updates. Set a practical boundary for this week, and notice what you hoped the checking would give you." },
  { t: "Rejection is not your identity", r: "Romans 8:31-39", p: "Name the verdict you have put on yourself. Read Romans 8:31-39 and set that verdict next to God's love in Christ. Leave room to grow without letting rejection define you." },
  { t: "Remember the whole story", r: "Psalm 139:23-24", p: "List what you miss, then what was also true: the good, the hard parts and your own part in it. Separate what you actually had from the future you imagined." },
  { t: "Take your attention back", r: "Matthew 6:25-34", p: "Give your full attention to one person or responsibility today, for its own sake, not as a performance for anyone." },
  { t: "Live forward", r: "Matthew 6:33-34", p: "Choose one realistic 30-day commitment in faith, character, a responsibility or a healthy friendship. Name the first step and who can support you. Keep room for rest and grief.", commit: true },
  { t: "Release again", r: "Proverbs 3:5-7", p: "Bring God what still hurts. Name what is yours to do and what is beyond your control. Carry forward the practices that helped, without demanding that seven days finish the healing." },
];

export const RB_STEPS = [
  { n: "Notice", t: 'Name the urge exactly as it is: "I feel ___ and I want to ___." It is a feeling, not an instruction.' },
  { n: "Name", t: "Ask what you want the action to give you. Reassurance? Closure? Proof that you still matter to them?" },
  { n: "Know", t: "What do you actually know, and what are you assuming? Bring the request itself to God (Philippians 4:6-7)." },
  { n: "Surrender", t: "Pray it plainly: tell God what you still want, and admit that you cannot control their feelings or the future. Ask him to hold both." },
  { n: "Obey", t: "Keep the boundary: close the app or put the phone down. Then meet the real need with rest, prayer, or a call to someone you trust." },
  { n: "Return", t: "If the urge comes back later, run this again. Coming back is part of the practice, not proof that you failed." },
];

export const PLAN_Q = [
  "What I am grieving, wanting or trying to secure",
  "What is actually true, and what I am assuming",
  "The Scripture and truth about God I will return to",
  "What I entrust to God, and what is still mine to do",
  "My boundary, the support I need, and my next faithful step",
  "My 30-day commitment, and how I will come back when the longing returns",
];

export const blankRelease = (): Release => ({ days: {}, cycles: 0, reach: 0, plan: {} });

/** Current Release Reset day (1-8, 8 = finished); one day opens per calendar day. */
export function rrState(rel: Release, now: Date = new Date()) {
  const days = rel.days || {};
  let cur = 1;
  while (cur <= 7 && days[cur]) cur++;
  return {
    days,
    cur,
    count: Object.keys(days).filter((k) => +k >= 1 && +k <= 7).length,
    open: cur <= 7 && (cur === 1 || days[cur - 1] !== dkey(now)),
  };
}
