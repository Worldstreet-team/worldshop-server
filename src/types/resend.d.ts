declare module 'resend' {
  export interface ResendSendEmailOptions {
    from: string;
    to: string[];
    subject: string;
    html: string;
  }

  export interface ResendSendEmailResponse {
    error?: { message: string };
  }

  export class Resend {
    constructor(apiKey?: string);
    emails: {
      send(options: ResendSendEmailOptions): Promise<ResendSendEmailResponse>;
    };
  }
}
