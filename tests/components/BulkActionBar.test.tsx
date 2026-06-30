/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import BulkActionBar from '../../components/BulkActionBar';

const base = { selectedCount: 0, willGenerateCount: 0, skipCount: 0, onGenerate: () => {}, onClear: () => {} };

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
