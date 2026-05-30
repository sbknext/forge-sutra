import './styles.css';
import logo from '../images/logo.svg';
import icon from '../icons/arrow.png';

export function Button({ label }: { label: string }) {
  return (
    <button className="btn">
      <img src={logo} alt="logo" />
      <img src={icon} alt="arrow" />
      {label}
    </button>
  );
}
