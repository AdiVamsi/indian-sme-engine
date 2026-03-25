'use strict';

const { isMissingLeadSnoozedUntilColumnError } = require('../lib/leadCompat');

describe('leadCompat', () => {
  it('detects classic missing snoozedUntil column errors', () => {
    expect(
      isMissingLeadSnoozedUntilColumnError(
        new Error("The column 'Lead.snoozedUntil' does not exist in the current database.")
      )
    ).toBe(true);
  });

  it('detects Prisma P2022 variants that include the column in meta data', () => {
    const err = new Error('The column `main.Lead.snoozedUntil` does not exist in the current database.');
    err.code = 'P2022';
    err.meta = {
      modelName: 'Lead',
      column: 'main.Lead.snoozedUntil',
    };

    expect(isMissingLeadSnoozedUntilColumnError(err)).toBe(true);
  });

  it('does not treat unrelated Prisma errors as snooze compatibility failures', () => {
    const err = new Error('Unique constraint failed on the fields: (`slug`)');
    err.code = 'P2002';

    expect(isMissingLeadSnoozedUntilColumnError(err)).toBe(false);
  });
});
