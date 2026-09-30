import "server-only";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = process.env.RESEND_FROM_ADDRESS ?? "tickets@aquasail.mu";

export type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: Array<{ filename: string; content: Buffer }>;
};

export async function sendEmail(payload: EmailPayload): Promise<{ id: string }> {
  const { data, error } = await resend.emails.send({
    from: FROM,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
    attachments: payload.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
    })),
  });
  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error("No message id returned from Resend.");
  return { id: data.id };
}
