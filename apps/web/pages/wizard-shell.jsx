import React from 'react';
import { AppShell } from '../app-shell.jsx';
import styles from './wizard-shell.module.css';

const TOTAL_STEPS = 4;

/**
 * Shared layout wrapper for all book creation wizard steps.
 *
 * @param {{ step: number, children: React.ReactNode }} props
 */
export function WizardShell({ step, children }) {
  return (
    <AppShell>
      <div className={styles.frame}>
        <StepTrack current={step} total={TOTAL_STEPS} />
        <div className={styles.content}>{children}</div>
      </div>
    </AppShell>
  );
}

function StepTrack({ current, total }) {
  return (
    <div className={styles.stepTrack} aria-label={`Step ${current} of ${total}`}>
      <span className={styles.stepLabel}>
        <strong>Step {current} of {total}</strong> · Create your book
      </span>
      <span className={styles.dots} aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={i < current ? styles.dotOn : styles.dotOff}
          />
        ))}
      </span>
    </div>
  );
}
