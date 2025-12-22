import * as React from 'react';
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Link,
  Button,
  Hr,
} from '@react-email/components';

interface VerificationEmailProps {
  verificationUrl: string;
  appName?: string;
}

export const VerificationEmail: React.FC<VerificationEmailProps> = ({
  verificationUrl,
  appName = 'SOVA Intel',
}) => {
  return (
    <Html>
      <Head />
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.section}>
            <Text style={styles.heading}>Verify your email</Text>

            <Text style={styles.paragraph}>
              Welcome to {appName}. Click the button below to verify your email
              address and start analyzing on-chain wallet behavior.
            </Text>

            <Button href={verificationUrl} style={styles.button}>
              Verify Email
            </Button>

            <Text style={styles.paragraph}>
              Or copy and paste this URL into your browser:
              <br />
              <Link href={verificationUrl} style={styles.link}>
                {verificationUrl}
              </Link>
            </Text>

            <Hr style={styles.hr} />

            <Text style={styles.footer}>
              If you didn&apos;t create an account, you can safely ignore this
              email.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

const styles = {
  body: {
    margin: '0',
    padding: '0',
    background: '#f5f5f5',
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif",
  },
  container: {
    maxWidth: '600px',
    margin: '40px auto',
    background: '#ffffff',
    padding: '40px',
    borderRadius: '8px',
  },
  section: {
    padding: '0',
  },
  heading: {
    margin: '0 0 24px 0',
    fontSize: '24px',
    fontWeight: '600',
    color: '#000000',
    lineHeight: '1.3',
  },
  paragraph: {
    margin: '0 0 24px 0',
    color: '#666666',
    fontSize: '16px',
    lineHeight: '1.6',
  },
  button: {
    display: 'inline-block',
    background: '#000000',
    color: '#ffffff',
    padding: '14px 28px',
    textDecoration: 'none',
    borderRadius: '6px',
    fontWeight: '500',
    fontSize: '16px',
    margin: '0 0 24px 0',
  },
  link: {
    color: '#666666',
    textDecoration: 'none',
    fontSize: '14px',
    wordBreak: 'break-all' as const,
  },
  hr: {
    border: 'none',
    borderTop: '1px solid #eeeeee',
    margin: '32px 0',
  },
  footer: {
    margin: '0',
    color: '#999999',
    fontSize: '12px',
    lineHeight: '1.5',
  },
};

export default VerificationEmail;
