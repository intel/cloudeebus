
Cloudeebus
==========

Cloudeebus is a component which enables calling dbus methods and registering on dbus signals from Javascript.


Example:
--------

The /doc/dbus-tools folder contains a dbus-send and a dbus-register server, with corresponding test pages.

 * Running a demo: from the project root directory

	python cloudeebus/cloudeebus.py &
	firefox file://`pwd`/doc/docdbus-tools/dbus-send.html  file://`pwd`/doc/dbus-tools/dbus-register.html &


Acknowledgements
----------------

Cloudeebus uses code from the following open-source projects

  * [AutobahnJS](http://autobahn.ws/js)
  * [AutobahnPython](http://autobahn.ws/python)
