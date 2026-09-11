// One-off dev/demo data script — NOT part of the standard `prisma db seed`
// pipeline (see prisma/seed.ts, which only bootstraps the admin account).
// Run manually: `bun run server/scripts/seed-ticket-110-replies.ts`.
//
// Populates ticket 110 with 20 replies alternating AGENT/CUSTOMER (agent
// first, replying to the ticket's own initial message), each at least 10
// lines long, to simulate a long-running conversation — useful for
// exercising TicketSummary.tsx's summarization feature against a thread
// that's actually substantial.
//
// TicketReply.authorId is a required FK to a real User (schema.prisma) —
// there's no customer-facing reply path yet, so every reply's *technical*
// author is a real agent account regardless of senderType (the same
// limitation POST /api/tickets/:id/replies already has, just applied here
// to both sides of a simulated conversation instead of only the AGENT
// side). senderType is what actually distinguishes the two speakers in
// the UI and in TicketSummary's transcript — the seeded body text is
// written from each side's own voice to make that distinction obvious to
// a reader even though the underlying `author` is the same account.
import { prisma } from "../src/lib/prisma.js";
import { ReplySenderType } from "../src/generated/prisma/enums.js";

const TICKET_ID = 110;

function reply(lines: string[]): string {
  const body = lines.join("\n");
  const lineCount = body.split("\n").length;
  if (lineCount < 10) {
    throw new Error(`Reply body must be at least 10 lines, got ${lineCount}:\n${body}`);
  }
  return body;
}

// Agent turns (indices 0, 2, 4, ... in the alternating thread below).
const agentReplies = [
  reply([
    "Hi Priya,",
    "",
    "Thanks for flagging this — sorry for the disruption to your workflow. I've pulled up your account",
    "and can see the sync errors starting yesterday around 3:40 PM UTC.",
    "",
    "Before I dig further, could you help me narrow this down a bit?",
    "1. Does this happen on every device, or just one (desktop app, mobile app, or both)?",
    "2. Is it every file, or only certain ones (large files, specific formats, shared folders)?",
    "3. Are you on the same network/Wi-Fi as when it last worked normally?",
    "",
    "I'll also check our sync service logs on our end in the meantime.",
  ]),
  reply([
    "Priya, thanks for those details — that's really helpful.",
    "",
    "I checked the sync service logs for your account and I can see repeated timeout errors when your",
    "desktop client tries to upload files larger than roughly 200MB. Smaller files are going through fine,",
    "which lines up with what you described.",
    "",
    "This looks like it could be one of two things:",
    "- A regression in the chunked-upload logic we shipped in Tuesday's release, or",
    "- A network-level timeout between your ISP and our upload endpoint for longer-running connections.",
    "",
    "Could you try uploading one of the affected files from a different network (e.g. your phone's hotspot)",
    "just to help me rule the second option out? No rush — whenever you get a chance today.",
  ]),
  reply([
    "Good catch on the hotspot test, and thanks for running it so quickly.",
    "",
    "Since it failed there too, that rules out your home network — this does look like it's on our side.",
    "I've escalated this to our infrastructure team with the timestamps and file sizes you gave me, and",
    "flagged it against Tuesday's chunked-upload release since the timing lines up closely.",
    "",
    "In the meantime, here's a workaround: if you compress the larger files into a zip before uploading,",
    "the chunked-upload path behaves differently and should avoid the timeout. It's not ideal, I know, but",
    "it should keep you moving while we get the root cause fixed.",
    "",
    "I'll update you as soon as I hear back from the infra team, hopefully within a few hours.",
  ]),
  reply([
    "Quick update, Priya — the infra team confirmed it's a bug in Tuesday's chunked-upload release,",
    "specifically a miscalculated timeout value for chunks above a certain size. A fix has been written",
    "and is going through testing now.",
    "",
    "They're expecting to deploy it within the next 24 hours. I'll ping you the moment it's live so you can",
    "drop the zip-file workaround and go back to uploading normally.",
    "",
    "A couple more questions while we wait, just so I can make sure nothing else got affected:",
    "1. Did you notice any issues with files you'd already uploaded before yesterday? Any that seem",
    "   corrupted or incomplete on the recipient's end?",
    "2. Are other people on your team hitting the same issue, or does it seem isolated to your account?",
  ]),
  reply([
    "Thanks for confirming nothing looks corrupted, and for checking with your team — good to hear it's",
    "not just isolated to something specific about your account.",
    "",
    "The fix has now been deployed to production as of about 20 minutes ago. Could you try uploading one",
    "of the larger files again, without the zip workaround, and let me know if it goes through cleanly?",
    "",
    "If it works, I'll go ahead and mark this as resolved on our end, but I'll keep an eye on the sync logs",
    "for your account over the next day just to be safe. If anything else comes up, even something small,",
    "please don't hesitate to reply here — I'd rather catch it early.",
    "",
    "Really appreciate your patience through this one.",
  ]),
  reply([
    "That's great news, Priya — really glad the direct upload is working again and the timing looks so",
    "much better than before.",
    "",
    "I've marked our internal tracking ticket for the chunked-upload bug as resolved, and I double-checked",
    "the sync logs on our side for your account over the last hour — everything's coming through clean,",
    "no timeouts or partial uploads.",
    "",
    "I'll leave this conversation open for a couple more days just so you have a direct line back to me",
    "in case anything resurfaces, rather than starting a whole new ticket. After that I'll close it out,",
    "but reopening is always easy if needed.",
    "",
    "Thanks again for your patience and for the clear details along the way — it made tracking this down",
    "a lot faster than it would have been otherwise.",
  ]),
  reply([
    "Following up as promised, Priya — it's been a couple of days now and the sync logs for your account",
    "continue to look completely normal, no timeouts or retries on any file size.",
    "",
    "A quick summary of what happened, for your records:",
    "1. A bug in Tuesday's chunked-upload release caused timeouts on files larger than ~200MB.",
    "2. Our infra team identified and fixed the root cause (a miscalculated chunk timeout value).",
    "3. The fix was deployed and you confirmed uploads were working normally again.",
    "",
    "I'm going to go ahead and close this ticket out now, but as always, just reply here if anything comes",
    "back up and it'll reopen straight to me — no need to start fresh.",
    "",
    "Thanks again for bearing with us on this one!",
  ]),
  reply([
    "One more small thing before I close this out, Priya — our infra team asked if it would be alright to",
    "reference the file-size threshold and error pattern from this ticket (fully anonymized, no account or",
    "file details) in their post-incident write-up for the chunked-upload bug.",
    "",
    "It genuinely helps future engineers spot similar patterns faster, but it's completely optional and",
    "only proceeds with your okay.",
    "",
    "Also, totally separately — I noticed you mentioned earlier that a couple of teammates were checking",
    "whether they were affected too. If any of them are still seeing anything unusual, even something minor",
    "or intermittent, please have them reach out and reference this ticket number so we can link the",
    "context immediately rather than starting from scratch.",
    "",
    "No rush on either of these — whenever's convenient.",
  ]),
  reply([
    "Thanks for the go-ahead on referencing the pattern anonymously, Priya — I've passed that along to the",
    "infra team, and good to hear your teammates aren't seeing anything unusual on their end either.",
    "",
    "I think that wraps everything up on our side. Here's where things stand as of today:",
    "- Root cause identified and fixed (chunked-upload timeout bug from Tuesday's release).",
    "- Your account's sync logs have been clean for several days across all file sizes.",
    "- No other team members reporting related issues.",
    "- Anonymized pattern shared with infra for their post-incident documentation.",
    "",
    "I'll close this ticket now. Thank you again for your patience and the detailed reports throughout —",
    "it made a real difference in resolving this quickly.",
  ]),
  reply([
    "Just circling back one final time, Priya, since it's been about a week since the fix went out.",
    "",
    "I pulled the sync logs for your account covering the full week and everything remains completely",
    "clean — no timeouts, no partial uploads, no retries, across every file size we track, including",
    "several well above the original ~200MB threshold that was causing trouble.",
    "",
    "I'm confident this is fully resolved and stable, so I'll mark this ticket as closed on our end now.",
    "As always, if anything related resurfaces down the line, replying here will bring it straight back to",
    "me with the full history already attached, rather than needing to re-explain everything from scratch.",
    "",
    "Thanks again for working through this with us, Priya — much appreciated.",
  ]),
];

// Customer turns (indices 1, 3, 5, ... in the alternating thread below).
const customerReplies = [
  reply([
    "Hi, thanks for getting back to me so fast.",
    "",
    "To answer your questions:",
    "1. It's happening on my desktop app. I haven't tried the mobile app yet, but I'll test that too.",
    "2. It seems to only happen with my larger project files — the small documents and images upload",
    "   completely fine, it's really just the bigger export files that are failing.",
    "3. Yes, same Wi-Fi as always, nothing's changed on my end that I'm aware of. My internet otherwise",
    "   feels totally normal for everything else I do.",
    "",
    "Let me know what else would help — I have a deadline coming up so I'm hoping we can sort this soon!",
  ]),
  reply([
    "Okay, I just tried uploading one of the failing files using my phone's hotspot instead of my home",
    "Wi-Fi, like you suggested.",
    "",
    "Unfortunately it still failed in exactly the same way — got about a third of the way through the",
    "progress bar and then it just hung for a while before showing the same timeout error message as",
    "before. So it sounds like you're right that it's probably not my network after all.",
    "",
    "I'll try the zip-file workaround you mentioned in the meantime since I really do need to get these",
    "files up today. Just to confirm — is there a size limit on the zipped version too, or should that be",
    "fine regardless of size?",
    "",
    "Appreciate you digging into the logs on your end, by the way.",
  ]),
  reply([
    "Good news — the zip workaround is working great, thank you! I was able to get all three of my",
    "pending files uploaded this morning without any issues, so that's taken the immediate pressure off.",
    "",
    "To answer your other questions:",
    "1. I went back and spot-checked a handful of files I uploaded before yesterday, and everything opens",
    "   fine on the recipient's end as far as I can tell — no corruption or missing content that I noticed.",
    "2. I checked with two teammates who also use the platform regularly, and neither of them has run into",
    "   this issue yet, so it might just be me, or maybe it's related to the specific file sizes I work",
    "   with since my exports tend to run pretty large.",
    "",
    "Really glad to hear it's already been tracked down to Tuesday's release — that's a fast turnaround!",
  ]),
  reply([
    "That's great to hear it's already fixed and deployed! I just tried uploading one of my larger files",
    "directly, without zipping it first, and it went through smoothly — noticeably faster than even the",
    "zip workaround was, actually.",
    "",
    "I uploaded three more files after that just to stress-test it a bit myself, all similar sizes to the",
    "ones that were failing before, and every single one completed without any hiccups or slowdowns.",
    "",
    "So from my side, everything looks resolved. Thank you (and your infra team) for turning this around",
    "so quickly — I was genuinely worried I'd miss my deadline earlier this week, but this got sorted with",
    "plenty of time to spare.",
    "",
    "I'll let you know right away if I notice anything odd over the next few days, but for now this looks",
    "great from where I'm sitting.",
  ]),
  reply([
    "Sounds perfect, thank you for keeping this open for a bit just in case — I appreciate that.",
    "",
    "Quick update from my side: it's now been a few days of totally normal use, including a couple of",
    "quite large exports (bigger than anything I was uploading when the original issue started), and",
    "everything has gone through cleanly every time, no delays or errors at all.",
    "",
    "I also checked in with the two teammates I mentioned earlier again, and they're still not seeing any",
    "issues on their accounts, so it really does seem like this was fully resolved by the fix you deployed.",
    "",
    "Feel free to close this out whenever makes sense on your end — and yes, absolutely fine to reference",
    "the anonymized pattern in your team's write-up if that's helpful for catching similar bugs faster in",
    "the future. Thanks again for all the help getting this sorted!",
  ]),
  reply([
    "Sounds good, thank you for keeping the door open a bit longer — I appreciate that rather than having",
    "to open a brand-new ticket if something small comes up.",
    "",
    "I'll keep an eye on things from my end over the next couple of days too. So far, since yesterday",
    "afternoon, everything has continued to work exactly as expected — no slow uploads, no errors, and no",
    "need for the zip workaround at all.",
    "",
    "I've also gone ahead and uploaded the rest of the project files I'd been holding off on because of",
    "this issue, just to give it a proper stress test, and every single one went through without any",
    "trouble. I'll message here right away if that changes at all.",
  ]),
  reply([
    "Thanks for the summary, that's really helpful to have written down for our own records too.",
    "",
    "I can confirm from my side it's been completely smooth for the full couple of days you mentioned —",
    "no timeouts, no errors, nothing unusual at all, even with a mix of file sizes ranging from small",
    "documents up to some of my biggest exports yet.",
    "",
    "Totally fine to close this out on your end. It's been a genuinely great support experience — clear",
    "updates throughout, a workaround while the real fix was in progress, and a fast turnaround once the",
    "root cause was found. Thank you and your infra team again for all the work on this.",
    "",
    "Looking forward to putting this one behind us.",
  ]),
  reply([
    "Happy to help with both of those, no problem at all.",
    "",
    "1. Yes, please go ahead and reference the anonymized pattern in your write-up — anything that helps",
    "   your team catch similar issues faster in the future is a good trade for the small inconvenience",
    "   this caused me. Glad something useful came out of it.",
    "2. I checked in with my teammates again just now, and both confirmed they haven't seen anything odd",
    "   on their accounts either, before, during, or after this whole thing. So it really does look like",
    "   it was specific to my account's file sizes rather than anything broader.",
    "",
    "Let me know if there's anything else you need from my side before wrapping this up.",
  ]),
  reply([
    "That all sounds great, thank you for such a thorough summary — it's nice to have the full picture",
    "laid out clearly like that, especially since I'll probably reference this ticket if I ever need to",
    "explain what happened to anyone else on my team.",
    "",
    "Everything genuinely has been rock solid since the fix went out — I've been uploading files of all",
    "sizes pretty much daily since then without giving it a second thought, which is exactly how it should",
    "be. No concerns at all on my end.",
    "",
    "Thanks again for such attentive support throughout this whole thing, from the very first diagnostic",
    "questions all the way through to this final confirmation. Really appreciated it.",
  ]),
  reply([
    "Thanks for checking back in after a full week, that's a nice touch and gives me a lot of confidence",
    "this is truly behind us now rather than something that might quietly resurface later.",
    "",
    "Can confirm from my side too — a full week of completely normal use, uploading all kinds of file",
    "sizes across several different projects, and not a single hiccup, timeout, or error the entire time.",
    "It's honestly like the issue never happened.",
    "",
    "Totally fine to mark this as closed for good. Thank you again, truly, for such clear communication",
    "and quick action from start to finish — it made a stressful few days a lot more manageable, and I'll",
    "definitely reach out here again if I ever need help in the future.",
  ]),
];

async function main() {
  let ticket = await prisma.ticket.findUnique({ where: { id: TICKET_ID } });

  if (!ticket) {
    const now = new Date();
    ticket = await prisma.ticket.create({
      data: {
        id: TICKET_ID,
        subject: "Large file uploads timing out during sync",
        body:
          "Hi, I've been having trouble uploading my larger project export files for the last day or so " +
          "— they get partway through and then fail with a timeout error. Smaller files upload just fine, " +
          "it's only the bigger ones that are affected. I have a deadline coming up soon and could really " +
          "use some help figuring out what's going on. Thanks!",
        requesterEmail: "priya.narayan@example.com",
        requesterName: "Priya Narayan",
        createdAt: now,
        updatedAt: now,
      },
    });

    // Ticket.id is a Postgres identity/serial column — inserting an
    // explicit id (110) doesn't advance the underlying sequence, so a
    // later auto-generated ticket could eventually collide with this one
    // once the sequence catches up. Bump the sequence past whatever we
    // just used (or the current max, if higher) so that never happens.
    const [{ seq }] = await prisma.$queryRawUnsafe<{ seq: string }[]>(
      `SELECT pg_get_serial_sequence('ticket', 'id') AS seq`,
    );
    await prisma.$executeRawUnsafe(
      `SELECT setval('${seq}', (SELECT GREATEST(MAX(id), ${TICKET_ID}) FROM ticket))`,
    );

    console.log(`Created ticket ${TICKET_ID}: "${ticket.subject}"`);
  } else {
    console.log(`Ticket ${TICKET_ID} already exists: "${ticket.subject}"`);
  }

  // A real agent account is required as the technical author for every
  // reply row regardless of senderType — see the file header comment.
  const agent = await prisma.user.findFirst({
    where: { role: "AGENT", deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  if (!agent) {
    throw new Error("No non-deleted AGENT user found to act as the reply author — seed one first.");
  }

  const baseTime = Date.now() - 10 * 24 * 60 * 60 * 1000; // start ~10 days ago
  const createdReplyIds: number[] = [];

  for (let i = 0; i < 20; i++) {
    const isAgentTurn = i % 2 === 0;
    const body = isAgentTurn ? agentReplies[i / 2]! : customerReplies[(i - 1) / 2]!;
    // Spaced ~6 hours apart so the thread reads as a realistic multi-day
    // back-and-forth rather than 20 messages sent in the same second.
    const createdAt = new Date(baseTime + i * 6 * 60 * 60 * 1000);

    const created = await prisma.ticketReply.create({
      data: {
        ticketId: TICKET_ID,
        authorId: agent.id,
        senderType: isAgentTurn ? ReplySenderType.AGENT : ReplySenderType.CUSTOMER,
        body,
        createdAt,
      },
    });
    createdReplyIds.push(created.id);
  }

  await prisma.ticket.update({
    where: { id: TICKET_ID },
    data: { updatedAt: new Date(baseTime + 19 * 6 * 60 * 60 * 1000) },
  });

  console.log(
    `Created ${createdReplyIds.length} replies on ticket ${TICKET_ID} (ids ${createdReplyIds[0]}-${
      createdReplyIds[createdReplyIds.length - 1]
    }), alternating AGENT/CUSTOMER starting with AGENT.`,
  );
}

await main();
await prisma.$disconnect();
