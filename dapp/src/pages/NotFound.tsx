import { Link } from 'react-router-dom';
import { PageTitle } from 'components/ui';

export const NotFound = () => (
  <div>
    <PageTitle title='Nothing here' lead='This page does not exist.' />
    <Link to='/' className='text-accent hover:underline'>
      Back to the start
    </Link>
  </div>
);
