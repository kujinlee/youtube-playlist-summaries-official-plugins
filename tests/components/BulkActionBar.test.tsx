/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import type { BatchMode } from '../../lib/html-doc/batch';
import BulkActionBar from '../../components/BulkActionBar';

const base = { selectedCount: 0, willGenerateCount: 0, skipCount: 0, mode: 'summary' as const, onModeChange: () => {}, onGenerate: () => {}, onClear: () => {} };

it('renders nothing when nothing is selected', () => {
  const { container } = render(<BulkActionBar {...base} />);
  expect(container).toBeEmptyDOMElement();
});

it('shows the will-generate count and a skip note', () => {
  render(<BulkActionBar {...base} selectedCount={5} willGenerateCount={3} skipCount={2} />);
  expect(screen.getByRole('button', { name: /Generate HTML doc — 3 videos/ })).toBeInTheDocument();
  expect(screen.getByText(/2 already current/)).toBeInTheDocument();
});

it('disables Generate when nothing needs work', () => {
  render(<BulkActionBar {...base} selectedCount={2} willGenerateCount={0} skipCount={2} />);
  expect(screen.getByRole('button', { name: /Generate HTML doc/ })).toBeDisabled();
});

it('calls onGenerate and onClear', () => {
  const onGenerate = jest.fn(), onClear = jest.fn();
  render(<BulkActionBar {...base} selectedCount={2} willGenerateCount={2} onGenerate={onGenerate} onClear={onClear} />);
  fireEvent.click(screen.getByRole('button', { name: /Generate HTML doc/ }));
  fireEvent.click(screen.getByRole('button', { name: /Clear/ }));
  expect(onGenerate).toHaveBeenCalled();
  expect(onClear).toHaveBeenCalled();
});

it('renders a mode toggle and calls onModeChange', () => {
  const onModeChange = jest.fn();
  render(<BulkActionBar {...base} selectedCount={2} willGenerateCount={2} mode="summary" onModeChange={onModeChange} />);
  fireEvent.click(screen.getByLabelText(/Summary \+ Dig-deeper/));
  expect(onModeChange).toHaveBeenCalledWith('summary-dig');
});

it('summary-dig Generate asks for confirmation; only fires onGenerate when confirmed', () => {
  const onGenerate = jest.fn();
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
  render(<BulkActionBar {...base} selectedCount={2} willGenerateCount={2} mode="summary-dig" onModeChange={() => {}} onGenerate={onGenerate} />);
  fireEvent.click(screen.getByRole('button', { name: /Generate/ }));
  expect(confirmSpy).toHaveBeenCalled();
  expect(onGenerate).not.toHaveBeenCalled();
  confirmSpy.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: /Generate/ }));
  expect(onGenerate).toHaveBeenCalled();
  confirmSpy.mockRestore();
});

it('summary mode Generate does not confirm', () => {
  const onGenerate = jest.fn();
  const confirmSpy = jest.spyOn(window, 'confirm');
  render(<BulkActionBar {...base} selectedCount={2} willGenerateCount={2} mode="summary" onModeChange={() => {}} onGenerate={onGenerate} />);
  fireEvent.click(screen.getByRole('button', { name: /Generate/ }));
  expect(confirmSpy).not.toHaveBeenCalled();
  expect(onGenerate).toHaveBeenCalled();
  confirmSpy.mockRestore();
});
