/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import AddByLink from '../../components/AddByLink';

const base = { value: '', onChange: () => {}, open: false, onOpenChange: () => {} };

it('is collapsed by default (toggle, no input)', () => {
  render(<AddByLink {...base} />);
  expect(screen.getByRole('button', { name: /Add by link/ })).toBeInTheDocument();
  expect(screen.queryByPlaceholderText(/Paste a playlist URL/)).toBeNull();
});
it('toggle opens when closed', () => {
  const onOpenChange = jest.fn();
  render(<AddByLink {...base} onOpenChange={onOpenChange} />);
  fireEvent.click(screen.getByRole('button', { name: /Add by link/ }));
  expect(onOpenChange).toHaveBeenCalledWith(true);
});
it('toggle closes when open', () => {
  const onOpenChange = jest.fn();
  render(<AddByLink {...base} open onOpenChange={onOpenChange} />);
  fireEvent.click(screen.getByRole('button', { name: /Add by link/ }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
it('shows and auto-focuses the input when open', () => {
  render(<AddByLink {...base} open />);
  const input = screen.getByPlaceholderText(/Paste a playlist URL/);
  expect(input).toBeInTheDocument();
  expect(document.activeElement).toBe(input);
});
it('propagates typing', () => {
  const onChange = jest.fn();
  render(<AddByLink {...base} open onChange={onChange} />);
  fireEvent.change(screen.getByPlaceholderText(/Paste a playlist URL/), { target: { value: 'https://youtube.com/playlist?list=PLx' } });
  expect(onChange).toHaveBeenCalledWith('https://youtube.com/playlist?list=PLx');
});
it('Escape collapses and prevents default', () => {
  const onOpenChange = jest.fn();
  render(<AddByLink {...base} open onOpenChange={onOpenChange} />);
  const input = screen.getByPlaceholderText(/Paste a playlist URL/);
  const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  const notPrevented = input.dispatchEvent(ev); // false when a handler called preventDefault
  expect(notPrevented).toBe(false);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
it('blur collapses when empty', () => {
  const onOpenChange = jest.fn();
  render(<AddByLink {...base} open value="" onOpenChange={onOpenChange} />);
  fireEvent.blur(screen.getByPlaceholderText(/Paste a playlist URL/));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
it('blur collapses when value equals the current url', () => {
  const onOpenChange = jest.fn();
  render(<AddByLink {...base} open value="https://youtube.com/playlist?list=PLc" currentUrl="https://youtube.com/playlist?list=PLc" onOpenChange={onOpenChange} />);
  fireEvent.blur(screen.getByPlaceholderText(/Paste a playlist URL/));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
it('blur keeps open for a new half-typed url', () => {
  const onOpenChange = jest.fn();
  render(<AddByLink {...base} open value="https://youtube.com/playlist?list=PLnew" currentUrl="" onOpenChange={onOpenChange} />);
  fireEvent.blur(screen.getByPlaceholderText(/Paste a playlist URL/));
  expect(onOpenChange).not.toHaveBeenCalled();
});
it('disables both the toggle and the input when disabled', () => {
  render(<AddByLink {...base} open disabled />);
  expect(screen.getByRole('button', { name: /Add by link/ })).toBeDisabled();
  expect(screen.getByPlaceholderText(/Paste a playlist URL/)).toBeDisabled();
});
