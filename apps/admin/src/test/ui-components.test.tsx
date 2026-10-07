import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import {
  Avatar,
  BackLink,
  DataTable,
  DecisionPanel,
  FilterChips,
  KpiTile,
  PageHeader,
  Plate,
  StatusChip,
  TablePager,
  initials,
  type ChipTone,
} from '../ui';

/** Design-system 2026-10-07 primitives shared by every admin page. */
describe('ui components', () => {
  it('renders each status chip tone with its own class', () => {
    const tones: ChipTone[] = ['accent', 'success', 'warning', 'danger', 'neutral'];
    render(
      <>
        {tones.map((tone) => (
          <StatusChip key={tone} tone={tone}>
            {`chip ${tone}`}
          </StatusChip>
        ))}
        <StatusChip strike>superseded</StatusChip>
      </>,
    );

    for (const tone of tones) {
      const chip = screen.getByText(`chip ${tone}`);
      expect(chip).toHaveClass('chip', `chip--${tone}`);
      expect(chip).toHaveAttribute('data-tone', tone);
    }
    // Neutral is the default tone; superseded items are struck through.
    expect(screen.getByText('superseded')).toHaveClass('chip--neutral', 'chip--strike');
  });

  it('marks selected filter chips as pressed and reports the clicked value', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <FilterChips
        label="Filter by status"
        options={[
          { value: 'submitted', label: 'Submitted', count: 3 },
          { value: 'approved', label: 'Approved' },
          { value: 'rejected', label: 'Rejected' },
        ]}
        isSelected={(value) => value === 'submitted'}
        isDisabled={(value) => value === 'rejected'}
        onSelect={onSelect}
      />,
    );

    const group = screen.getByRole('group', { name: 'Filter by status' });
    const submitted = within(group).getByRole('button', { name: 'Submitted · 3' });
    expect(submitted).toHaveAttribute('aria-pressed', 'true');
    expect(submitted).toHaveClass('filter-chip--active');
    const approved = within(group).getByRole('button', { name: 'Approved' });
    expect(approved).toHaveAttribute('aria-pressed', 'false');
    expect(approved).not.toHaveClass('filter-chip--active');
    expect(within(group).getByRole('button', { name: 'Rejected' })).toBeDisabled();

    await user.click(approved);
    expect(onSelect).toHaveBeenCalledWith('approved');
  });

  it('shows the empty state instead of a table, and the table otherwise', () => {
    const rows = (
      <>
        <thead>
          <tr>
            <th>Name</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Rami</td>
          </tr>
        </tbody>
      </>
    );
    const { rerender } = render(
      <DataTable title="Renewals" isEmpty empty="Nothing to review.">
        {rows}
      </DataTable>,
    );

    expect(screen.getByRole('heading', { name: 'Renewals' })).toBeInTheDocument();
    expect(screen.getByText('Nothing to review.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    rerender(
      <DataTable
        title="Renewals"
        empty="Nothing to review."
        footer={
          <TablePager
            status="Page 1 of 1"
            previousLabel="Previous"
            nextLabel="Next"
            canPrevious={false}
            canNext
            onPrevious={() => undefined}
            onNext={() => undefined}
          />
        }
      >
        {rows}
      </DataTable>,
    );
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Rami' })).toBeInTheDocument();
    expect(screen.queryByText('Nothing to review.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('renders plates right-to-left in Arabic type, even inside an English layout', () => {
    render(<Plate value="دمشق 509876" />);
    const plate = screen.getByText('دمشق 509876');
    expect(plate).toHaveAttribute('dir', 'rtl');
    expect(plate).toHaveAttribute('lang', 'ar');
    expect(plate).toHaveClass('plate');
  });

  it('renders the page header, back link, KPI tile and decision panel', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <BackLink to="/driver-applications">Back to applications</BackLink>
        <PageHeader
          title="Driver applications"
          description="Oldest first."
          actions={<button type="button">Create</button>}
        />
        <KpiTile label="Expired" value={2} tone="danger" />
        <DecisionPanel title="Decision">
          <button type="button">Approve</button>
        </DecisionPanel>
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Back to applications' })).toHaveAttribute(
      'href',
      '/driver-applications',
    );
    expect(screen.getByRole('heading', { name: 'Driver applications', level: 1 })).toBeVisible();
    expect(screen.getByText('Oldest first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
    expect(screen.getByText('2').closest('.kpi')).toHaveClass('kpi--danger');
    const panel = screen.getByRole('complementary');
    expect(within(panel).getByRole('heading', { name: 'Decision' })).toBeInTheDocument();
  });

  it('derives avatar initials from the first two words', () => {
    expect(initials('Dev Admin')).toBe('DA');
    expect(initials('  rami  haddad al-masri ')).toBe('RH');
    expect(initials('لبي')).toBe('ل');
    render(<Avatar name="Dev Admin" />);
    expect(screen.getByText('DA')).toHaveAttribute('aria-hidden', 'true');
  });
});
